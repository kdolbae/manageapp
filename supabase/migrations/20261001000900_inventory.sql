-- =============================================================================
-- D9: 자재·창고 — 창고(warehouse) · 품목(inv_item) · 단가(inv_item_price) · 입출고(inv_move) · 금액(inv_move_amount)
--  nanomaster-web 의 재고 모듈(inv_items/inv_moves) 규칙을 사업체·창고·권한 모델 위로 옮긴 것.
--  - 금액은 별도 테이블에 두고 inventory.price 권한이 있어야만 읽힌다 (시공자에게는 아예 안 내려간다)
--  - 줄마다 그때의 단가를 박아 둔다. 취소는 void 로만 (삭제 없음)
--  - 재고 = 창고로 들어온 수량 − 창고에서 나간 수량 (취소분 제외). 부족 출고는 inventory.force 가 있어야 한다
-- =============================================================================

create table public.warehouse (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id),
  branch_id      uuid references public.branch(id),
  kind           text not null default 'hq' check (kind in ('hq','branch','vehicle','site')),
  name           text not null,
  technician_id  uuid references public.technician(id),   -- 차량 창고(시공자 개인 재고)
  is_default     boolean not null default false,
  status         text not null default 'active' check (status in ('active','inactive')),
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create unique index warehouse_name_uq on public.warehouse (tenant_id, name) where deleted_at is null;
create unique index warehouse_technician_uq on public.warehouse (technician_id) where technician_id is not null and deleted_at is null;

create table public.inv_item (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id),
  category_code  text not null,                          -- code_value(inv_category)
  code           text,                                   -- 품목 코드(선택)
  name           text not null,
  spec           text,                                   -- 규격·용량
  full_name      text,                                   -- 거래명세서 정식 명칭
  unit           text not null default 'EA',
  min_stock      numeric(12,2) not null default 0,
  product_id     uuid references public.product(id),     -- 판매 상품과 연결(선택)
  memo           text,
  status         text not null default 'active' check (status in ('active','inactive')),
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create unique index inv_item_name_uq on public.inv_item (tenant_id, category_code, name, coalesce(spec, '')) where deleted_at is null;
create unique index inv_item_code_uq on public.inv_item (tenant_id, code) where code is not null and deleted_at is null;

create table public.inv_item_price (
  item_id     uuid primary key references public.inv_item(id) on delete cascade,
  tenant_id   uuid not null references public.tenant(id),
  buy_price   numeric(14,0) not null default 0,          -- 매입단가(부가세 별도)
  sell_price  numeric(14,0) not null default 0,          -- 판매단가(부가세 별도), 0 = 미설정
  price_note  text,
  updated_at  timestamptz not null default now()
);

create table public.inv_move (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id),
  item_id            uuid not null references public.inv_item(id),
  kind               text not null check (kind in ('in','out','transfer','adjust')),
  qty                numeric(12,2) not null check (qty > 0),
  from_warehouse_id  uuid references public.warehouse(id),
  to_warehouse_id    uuid references public.warehouse(id),
  moved_on           date not null default current_date,
  reason             text not null default 'purchase'
                     check (reason in ('purchase','return_in','adjust_in','opening','install','sale','sample','waste','return_out','adjust_out','transfer')),
  partner_id         uuid references public.partner(id),
  partner_name       text,                               -- 거래처 이름(협력업체 아닌 경우)
  doc_no             text,                               -- 거래명세서 번호
  job_id             uuid references public.job(id),
  contract_id        uuid references public.contract(id),
  technician_id      uuid references public.technician(id),  -- 가져간 시공자
  note               text,
  created_by         uuid references public.profile(id),
  created_at         timestamptz not null default now(),
  voided_at          timestamptz,
  voided_by          uuid references public.profile(id),
  void_reason        text,
  check ((kind = 'in' and to_warehouse_id is not null and from_warehouse_id is null)
      or (kind = 'out' and from_warehouse_id is not null and to_warehouse_id is null)
      or (kind = 'transfer' and from_warehouse_id is not null and to_warehouse_id is not null and from_warehouse_id <> to_warehouse_id)
      or (kind = 'adjust' and ((from_warehouse_id is null) <> (to_warehouse_id is null))))
);
create index inv_move_item_idx on public.inv_move (item_id, moved_on desc) where voided_at is null;
create index inv_move_tenant_idx on public.inv_move (tenant_id, moved_on desc, created_at desc);
create index inv_move_tech_idx on public.inv_move (technician_id, moved_on desc) where technician_id is not null;
create index inv_move_job_idx on public.inv_move (job_id) where job_id is not null;

create table public.inv_move_amount (
  move_id        uuid primary key references public.inv_move(id) on delete cascade,
  tenant_id      uuid not null references public.tenant(id),
  unit_price     numeric(14,0) not null default 0,
  supply_amount  numeric(14,0) not null default 0,       -- 수량 × 단가
  vat_amount     numeric(14,0) not null default 0,       -- 공급가액의 10%
  updated_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 재고 뷰: 창고별 수량 (취소분 제외)
-- -----------------------------------------------------------------------------
create or replace view public.inv_stock with (security_invoker = true) as
select tenant_id, item_id, warehouse_id, sum(delta) as qty, max(moved_on) as last_moved_on
from (
  select tenant_id, item_id, to_warehouse_id as warehouse_id, qty as delta, moved_on from public.inv_move where voided_at is null and to_warehouse_id is not null
  union all
  select tenant_id, item_id, from_warehouse_id, -qty, moved_on from public.inv_move where voided_at is null and from_warehouse_id is not null
) m
group by tenant_id, item_id, warehouse_id;
grant select on public.inv_stock to authenticated;

create or replace function app.warehouse_stock(p_item uuid, p_warehouse uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when to_warehouse_id = p_warehouse then qty else 0 end) - sum(case when from_warehouse_id = p_warehouse then qty else 0 end), 0)
  from public.inv_move where item_id = p_item and voided_at is null and (to_warehouse_id = p_warehouse or from_warehouse_id = p_warehouse)
$$;

create or replace function app.my_technician_id(tid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.id from public.technician t where t.tenant_id = tid and t.profile_id = auth.uid() and t.deleted_at is null limit 1
$$;

-- -----------------------------------------------------------------------------
-- 기본값: 분류 코드 + 본사 창고 (새 사업체 자동)
-- -----------------------------------------------------------------------------
create or replace function app.seed_inventory_defaults(tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.code_value (tenant_id, domain, code, label, color, sort_order) values
    (tid, 'inv_category', 'coating',    '코팅제',       null, 1),
    (tid, 'inv_category', 'material',   '자재·부자재',  null, 2),
    (tid, 'inv_category', 'consumable', '소모품',       null, 3),
    (tid, 'inv_category', 'supply',     '비품·용품',    null, 4),
    (tid, 'inv_category', 'tool',       '공구·장비',    null, 5),
    (tid, 'inv_category', 'goods',      '판매 상품',    null, 6),
    (tid, 'inv_category', 'etc',        '기타',         null, 99)
  on conflict (tenant_id, domain, code) do nothing;
  if not exists (select 1 from public.warehouse where tenant_id = tid and deleted_at is null) then
    insert into public.warehouse (tenant_id, kind, name, is_default) values (tid, 'hq', '본사 창고', true);
  end if;
end $$;
select app.seed_inventory_defaults(id) from public.tenant;
create or replace function app.tenant_seed_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.seed_inventory_defaults(new.id);
  return new;
end $$;
create trigger tenant_seed_inventory after insert on public.tenant for each row execute function app.tenant_seed_inventory();

-- -----------------------------------------------------------------------------
-- 트리거: 작성자·시공자 자동, 재고 부족 차단, 금액 자동, 수정 잠금(취소만)
-- -----------------------------------------------------------------------------
create or replace function app.inv_move_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare stock numeric; wh record;
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  -- 출고·이동은 가져간 시공자를 자동으로, 본인 범위(own) 계정은 어떤 종류든 본인 시공자로 기록한다 (차량 창고 반품 입고 등)
  if new.technician_id is null and (new.kind in ('out','transfer') or not app.in_scope(new.tenant_id, null, null)) then
    new.technician_id := app.my_technician_id(new.tenant_id);
  end if;
  if new.job_id is not null and new.contract_id is null then
    select j.contract_id into new.contract_id from public.job j where j.id = new.job_id;
  end if;
  if new.reason = 'transfer' and new.kind <> 'transfer' then new.reason := case when new.kind = 'in' then 'purchase' else 'install' end; end if;
  if new.kind = 'transfer' then new.reason := 'transfer'; end if;
  if new.from_warehouse_id is not null then
    select * into wh from public.warehouse where id = new.from_warehouse_id and tenant_id = new.tenant_id and deleted_at is null;
    if wh is null then raise exception '출고 창고를 찾지 못했습니다'; end if;
    stock := app.warehouse_stock(new.item_id, new.from_warehouse_id);
    if stock < new.qty and not app.has_perm(new.tenant_id, 'inventory.force') then
      raise exception '재고 부족: % 에 %개 남아 있어 %개를 낼 수 없습니다', wh.name, stock, new.qty using errcode = 'P0001';
    end if;
  end if;
  if new.to_warehouse_id is not null and not exists (select 1 from public.warehouse where id = new.to_warehouse_id and tenant_id = new.tenant_id and deleted_at is null) then
    raise exception '입고 창고를 찾지 못했습니다';
  end if;
  return new;
end $$;
create trigger inv_move_before_insert before insert on public.inv_move for each row execute function app.inv_move_before_insert();

create or replace function app.inv_move_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare p numeric;
begin
  select case when new.reason = 'sale' then coalesce(nullif(ip.sell_price, 0), ip.buy_price) else ip.buy_price end
    into p from public.inv_item_price ip where ip.item_id = new.item_id;
  p := coalesce(p, 0);
  insert into public.inv_move_amount (move_id, tenant_id, unit_price, supply_amount, vat_amount)
  values (new.id, new.tenant_id, p, round(p * new.qty), round(p * new.qty * 0.1));
  return new;
end $$;
create trigger inv_move_after_insert after insert on public.inv_move for each row execute function app.inv_move_after_insert();

create or replace function app.inv_move_guard_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.voided_at is not null then
    raise exception '취소된 내역은 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if new.item_id <> old.item_id or new.kind <> old.kind or new.qty <> old.qty or new.moved_on <> old.moved_on
     or new.from_warehouse_id is distinct from old.from_warehouse_id or new.to_warehouse_id is distinct from old.to_warehouse_id then
    raise exception '입출고 내역은 고칠 수 없습니다. 취소하고 다시 등록하세요' using errcode = '42501';
  end if;
  if new.voided_at is not null then
    new.voided_by := auth.uid();
    if new.void_reason is null then raise exception '취소 사유를 적어 주세요'; end if;
  end if;
  return new;
end $$;
create trigger inv_move_guard_update before update on public.inv_move for each row execute function app.inv_move_guard_update();

create or replace function app.inv_move_amount_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare q numeric;
begin
  select qty into q from public.inv_move where id = new.move_id;
  new.supply_amount := round(new.unit_price * q);
  new.vat_amount := round(new.unit_price * q * 0.1);
  new.updated_at := now();
  return new;
end $$;
create trigger inv_move_amount_before_update before update on public.inv_move_amount for each row execute function app.inv_move_amount_before_update();

do $$
declare t text;
begin
  foreach t in array array['warehouse','inv_item'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['warehouse','inv_item','inv_item_price','inv_move','inv_move_amount'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS
--  inventory.read 재고·품목·내역 조회(시공자: 본인 내역·본인 차량 창고), inventory.move 입출고,
--  inventory.price 단가·금액 조회·수정 + 품목·창고 관리, inventory.force 재고 초과 출고
-- -----------------------------------------------------------------------------
alter table public.warehouse       enable row level security;
alter table public.inv_item        enable row level security;
alter table public.inv_item_price  enable row level security;
alter table public.inv_move        enable row level security;
alter table public.inv_move_amount enable row level security;

create policy warehouse_select on public.warehouse for select to authenticated using (app.has_perm(tenant_id, 'inventory.read'));
create policy warehouse_write on public.warehouse for all to authenticated
  using (app.has_perm(tenant_id, 'inventory.price')) with check (app.has_perm(tenant_id, 'inventory.price'));

create policy inv_item_select on public.inv_item for select to authenticated using (app.has_perm(tenant_id, 'inventory.read'));
create policy inv_item_write on public.inv_item for all to authenticated
  using (app.has_perm(tenant_id, 'inventory.price')) with check (app.has_perm(tenant_id, 'inventory.price'));

create policy inv_item_price_all on public.inv_item_price for all to authenticated
  using (app.has_perm(tenant_id, 'inventory.price')) with check (app.has_perm(tenant_id, 'inventory.price'));

create policy inv_move_select on public.inv_move for select to authenticated
  using (app.has_perm(tenant_id, 'inventory.read')
         and (app.in_scope(tenant_id, null, created_by)
              or technician_id = app.my_technician_id(tenant_id)
              or exists (select 1 from public.warehouse w where w.technician_id = app.my_technician_id(tenant_id) and w.id in (from_warehouse_id, to_warehouse_id))));
create policy inv_move_insert on public.inv_move for insert to authenticated
  with check (app.has_perm(tenant_id, 'inventory.move') and (created_by is null or created_by = auth.uid())
              -- 사업체·지점 범위는 어떤 이동이든, 본인 범위(시공자)는 본인 시공자로 기록되는 이동만
              and (app.in_scope(tenant_id, null, null) or technician_id = app.my_technician_id(tenant_id)));
create policy inv_move_update on public.inv_move for update to authenticated
  using (app.has_perm(tenant_id, 'inventory.move') and (created_by = auth.uid() or app.has_perm(tenant_id, 'inventory.price')))
  with check (app.has_perm(tenant_id, 'inventory.move'));

-- 품목 분류는 단가 관리자(inventory.price)도 만들 수 있다 (CSV 가져오기)
create policy code_value_inv_category on public.code_value for insert to authenticated
  with check (domain = 'inv_category' and app.has_perm(tenant_id, 'inventory.price'));

create policy inv_move_amount_select on public.inv_move_amount for select to authenticated using (app.has_perm(tenant_id, 'inventory.price'));
create policy inv_move_amount_update on public.inv_move_amount for update to authenticated
  using (app.has_perm(tenant_id, 'inventory.price')) with check (app.has_perm(tenant_id, 'inventory.price'));

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
