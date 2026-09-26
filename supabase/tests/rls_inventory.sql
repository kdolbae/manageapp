\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select id as hq from public.warehouse where tenant_id = :'t1' and is_default \gset
do $$ begin
  if (select count(*) from public.code_value where domain = 'inv_category') < 7 then raise exception 'inv categories not seeded'; end if;
  if (select count(*) from public.warehouse) <> 1 then raise exception 'default warehouse missing'; end if;
end $$;
-- A: 품목 + 단가 + 차량 창고(기사 C) + 입고 10
select t.id as tech_c from public.technician t where t.profile_id = 'c0000000-0000-4000-8000-000000000003' and t.tenant_id = :'t1' \gset
insert into public.inv_item (tenant_id, category_code, name, spec, unit, min_stock) values (:'t1', 'coating', '글라스', '500ml', 'EA', 3) returning id as item \gset
insert into public.inv_item_price (item_id, tenant_id, buy_price, sell_price) values (:'item', :'t1', 63000, 130000);
insert into public.warehouse (tenant_id, kind, name, technician_id) values (:'t1', 'vehicle', 'C 차량', :'tech_c') returning id as car \gset
insert into public.inv_move (tenant_id, item_id, kind, qty, to_warehouse_id, reason, partner_name, doc_no) values (:'t1', :'item', 'in', 10, :'hq', 'purchase', '샤이닉스', 'D-1') returning id as m1 \gset
select set_config('test.item', :'item', false); select set_config('test.hq', :'hq', false); select set_config('test.car', :'car', false);
do $$ begin
  if (select unit_price from public.inv_move_amount) <> 63000 then raise exception 'amount not auto-filled'; end if;
  if (select supply_amount from public.inv_move_amount) <> 630000 then raise exception 'supply amount'; end if;
  if (select qty from public.inv_stock where warehouse_id = current_setting('test.hq')::uuid) <> 10 then raise exception 'stock after in'; end if;
end $$;
-- A: 본사 → C 차량 이동 4
insert into public.inv_move (tenant_id, item_id, kind, qty, from_warehouse_id, to_warehouse_id) values (:'t1', :'item', 'transfer', 4, :'hq', :'car');
-- C(기사): 품목·재고는 보이고 단가·금액은 안 보인다. 본인 차량에서 출고 3 (시공자 자동), 재고 초과 출고는 막힌다
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.inv_item) <> 1 then raise exception 'C should see items'; end if;
  if (select count(*) from public.inv_item_price) <> 0 then raise exception 'C sees prices'; end if;
  if (select count(*) from public.inv_move_amount) <> 0 then raise exception 'C sees amounts'; end if;
  if (select qty from public.inv_stock where warehouse_id = current_setting('test.car')::uuid) <> 4 then raise exception 'C should see own vehicle stock (transfer visible)'; end if;
end $$;
insert into public.inv_move (tenant_id, item_id, kind, qty, from_warehouse_id, reason, note) values (:'t1', :'item', 'out', 3, :'car', 'install', '주방 시공') returning id as m3 \gset
do $$ begin
  if (select technician_id from public.inv_move where note = '주방 시공') is null then raise exception 'technician not auto-set'; end if;
  if (select qty from public.inv_stock where warehouse_id = current_setting('test.car')::uuid) <> 1 then raise exception 'car stock after out'; end if;
  begin
    insert into public.inv_move (tenant_id, item_id, kind, qty, from_warehouse_id, reason) values ((select id from public.tenant where slug = 'nanomaster'), current_setting('test.item')::uuid, 'out', 5, current_setting('test.car')::uuid, 'install');
    raise exception 'over-stock out allowed for C';
  exception when raise_exception then
    if sqlerrm not like '재고 부족%' then raise; end if;
  end;
  begin
    update public.inv_move set qty = 1 where note = '주방 시공';
    raise exception 'C edited qty';
  exception when insufficient_privilege then null; end;
end $$;
-- C: 본인 내역 취소는 된다 (사유 필수)
update public.inv_move set voided_at = now(), void_reason = '잘못 찍음' where id = :'m3';
do $$ begin
  if (select qty from public.inv_stock where warehouse_id = current_setting('test.car')::uuid) <> 4 then raise exception 'void not reflected'; end if;
  if (select voided_by from public.inv_move where id = current_setting('test.item')::uuid) is not null then null; end if;
end $$;
-- A: 초과 출고는 force 권한(대표)으로 가능, 단가 수정 가능
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
insert into public.inv_move (tenant_id, item_id, kind, qty, from_warehouse_id, reason, note) values (:'t1', :'item', 'out', 8, :'hq', 'install', '초과 출고');
update public.inv_move_amount set unit_price = 60000 where move_id = :'m1';
do $$ begin
  if (select qty from public.inv_stock where warehouse_id = current_setting('test.hq')::uuid) <> -2 then raise exception 'forced out stock'; end if;
  if (select supply_amount from public.inv_move_amount where unit_price = 60000) <> 600000 then raise exception 'amount recalculated'; end if;
  if (select count(*) from public.inv_move) < 4 then raise exception 'A should see 4+ moves'; end if;
end $$;
-- D(지점장, branch 범위): 입고를 등록할 수 있다 (권한이 있을 때). 분류 추가는 inventory.price 로 가능
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000004', false);
do $$ begin
  if app.has_perm((select id from public.tenant where slug = 'nanomaster'), 'inventory.move') then
    insert into public.inv_move (tenant_id, item_id, kind, qty, to_warehouse_id, reason, note) values ((select id from public.tenant where slug = 'nanomaster'), current_setting('test.item')::uuid, 'in', 2, current_setting('test.hq')::uuid, 'purchase', '지점장 입고');
    if not exists (select 1 from public.inv_move where note = '지점장 입고') then raise exception 'branch manager could not insert'; end if;
  end if;
  if app.has_perm((select id from public.tenant where slug = 'nanomaster'), 'inventory.price') then
    insert into public.code_value (tenant_id, domain, code, label, sort_order) values ((select id from public.tenant where slug = 'nanomaster'), 'inv_category', 'ctest', 'CSV 분류', 50);
    if not exists (select 1 from public.code_value where code = 'ctest') then raise exception 'inv_category insert failed'; end if;
  end if;
end $$;
-- C(기사): 본인 차량으로 반품 입고 가능 (시공자 자동 기록)
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
insert into public.inv_move (tenant_id, item_id, kind, qty, to_warehouse_id, reason, note) values (:'t1', :'item', 'in', 1, :'car', 'return_in', '차량 반품');
do $$ begin
  if (select technician_id from public.inv_move where note = '차량 반품') is null then raise exception 'technician not set on own in-move'; end if;
end $$;
-- G(t2): 아무것도 안 보임
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.inv_item) + (select count(*) from public.inv_move) + (select count(*) from public.warehouse) <> 0 then raise exception 'G sees t1 inventory'; end if;
end $$;
reset role;
select 'RLS inventory tests passed' as result;
