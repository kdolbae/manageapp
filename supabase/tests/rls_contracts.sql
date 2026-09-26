-- D3 RLS 테스트. rls_foundation.sql, rls_parties_products.sql 다음에 실행.
\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select id as c1 from public.customer where name = '김서연' \gset
select id as s1 from public.site where customer_id = :'c1' \gset
select id as prod from public.product where code = 'K-COAT' \gset
select id as tech_c from public.technician where name = 'C 기사' \gset
select id as b_dg from public.branch where tenant_id = :'t1' and code = 'DG' \gset

-- A: 계약 + 품목 2개 + 시공 건 2개 (주방/욕실)
insert into public.contract (tenant_id, customer_id, site_id, contract_date, sales_owner_id)
  values (:'t1', :'c1', :'s1', date '2026-09-23', 'a0000000-0000-4000-8000-000000000001');
select id as k1, contract_no as no1 from public.contract where customer_id = :'c1' \gset
insert into public.contract_line (tenant_id, contract_id, product_id, name, work_area_code, qty, unit_price, technician_rate)
  values (:'t1', :'k1', :'prod', '주방 상판 코팅', 'kitchen', 1, 980000, 250000),
         (:'t1', :'k1', null, '욕실 줄눈', 'bath', 1, 880000, 200000);
insert into public.job (tenant_id, contract_id, work_area_code, scheduled_date, technician_id)
  values (:'t1', :'k1', 'kitchen', date '2026-09-30', :'tech_c');
insert into public.job (tenant_id, contract_id, work_area_code) values (:'t1', :'k1', 'bath');
select id as j_k from public.job where work_area_code = 'kitchen' \gset
select id as j_b from public.job where work_area_code = 'bath' \gset

do $$ begin
  if (select contract_no from public.contract limit 1) !~ '^C26-\d{4}$' then raise exception 'contract_no format'; end if;
  if (select sum(amount) from public.contract_line) <> 1860000 then raise exception 'line amount calc'; end if;
  if (select status from public.job where work_area_code = 'kitchen') <> 'assigned' then raise exception 'auto status assigned'; end if;
  if (select status from public.job where work_area_code = 'bath') <> 'undecided' then raise exception 'auto status undecided'; end if;
  if public.contract_status((select id from public.contract limit 1)) <> 'pending_approval' then raise exception 'status should be pending_approval'; end if;
  if (select count(*) from public.job_assignment where unassigned_at is null) <> 1 then raise exception 'assignment history'; end if;
  if (select count(*) from public.status_history where entity = 'job') <> 2 then raise exception 'job status history'; end if;
end $$;

-- 승인 → 상태 계산
update public.contract set approval_status = 'approved' where id = :'k1';
do $$ begin
  if public.contract_status((select id from public.contract limit 1)) <> 'scheduled' then raise exception 'status should be scheduled'; end if;
end $$;

-- C(기사): 배정된 계약·본인 시공 건만, 상태 완료 처리 가능, 배정/날짜 변경 불가, 품목 금액 조회 가능
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.contract) <> 1 then raise exception 'C should see assigned contract'; end if;
  if (select count(*) from public.job) <> 1 then raise exception 'C should see only own job'; end if;
  if (select count(*) from public.contract_line) <> 2 then raise exception 'C should see lines of visible contract'; end if;
  begin
    update public.job set scheduled_date = date '2026-10-01' where work_area_code = 'kitchen';
    raise exception 'C changed schedule';
  exception when insufficient_privilege then null; end;
  begin
    update public.job set technician_id = null where work_area_code = 'kitchen';
    raise exception 'C changed assignment';
  exception when insufficient_privilege then null; end;
  update public.job set status = 'in_progress' where work_area_code = 'kitchen';
  if (select started_at from public.job where work_area_code = 'kitchen') is null then raise exception 'started_at not set'; end if;
  update public.job set status = 'done' where work_area_code = 'kitchen';
  if (select completed_at from public.job where work_area_code = 'kitchen') is null then raise exception 'completed_at not set'; end if;
  begin
    update public.contract set approval_status = 'rejected';
    if exists (select 1 from public.contract where approval_status = 'rejected') then raise exception 'C changed approval'; end if;
  exception when insufficient_privilege then null; end;
end $$;

-- E(사무·상담, tenant 범위): 계약 수정 가능, 승인 불가(contract.approve 없음), 배정 가능(job.assign 있음)
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  if (select count(*) from public.contract) <> 1 then raise exception 'E should see contract'; end if;
  update public.contract set memo = 'staff memo';
  if not exists (select 1 from public.contract where memo = 'staff memo') then raise exception 'E could not edit contract'; end if;
  begin
    update public.contract set approval_status = 'rejected';
    raise exception 'E changed approval without permission';
  exception when insufficient_privilege then null; end;
  update public.job set scheduled_date = date '2026-10-02', technician_id = (select id from public.technician where name = 'C 기사') where work_area_code = 'bath';
  if (select status from public.job where work_area_code = 'bath') <> 'assigned' then raise exception 'E assignment failed'; end if;
end $$;

-- E: RPC 로 계약 한 번에 등록 (품목 2, 시공 건 2)
do $$
declare cid uuid; tid uuid := (select id from public.tenant limit 1);
begin
  cid := public.create_contract(jsonb_build_object(
    'tenant_id', tid, 'customer_id', (select id from public.customer where name = '김서연'), 'contract_date', '2026-09-24',
    'lines', jsonb_build_array(
      jsonb_build_object('name', '주방 코팅', 'work_area_code', 'kitchen', 'qty', 1, 'unit_price', 500000),
      jsonb_build_object('name', '욕실 줄눈', 'work_area_code', 'bath', 'qty', 2, 'unit_price', 100000, 'discount', 20000)),
    'jobs', jsonb_build_array(
      jsonb_build_object('work_area_code', 'kitchen', 'scheduled_date', '2026-10-05'),
      jsonb_build_object('work_area_code', 'bath'))));
  if (select count(*) from public.contract_line where contract_id = cid) <> 2 then raise exception 'rpc lines'; end if;
  if (select count(*) from public.job where contract_id = cid) <> 2 then raise exception 'rpc jobs'; end if;
  if (select count(*) from public.job_line jl join public.job j on j.id = jl.job_id where j.contract_id = cid) <> 2 then raise exception 'rpc job_line'; end if;
  if (select sum(amount) from public.contract_line where contract_id = cid) <> 680000 then raise exception 'rpc amount'; end if;
  if (select contract_no from public.contract where id = cid) <> 'C26-0002' then raise exception 'rpc contract_no'; end if;
end $$;

-- G(사업체2): 아무것도 안 보임
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.contract) <> 0 then raise exception 'G sees t1 contracts'; end if;
  if (select count(*) from public.job) <> 0 then raise exception 'G sees t1 jobs'; end if;
  if (select count(*) from public.contract_line) <> 0 then raise exception 'G sees t1 lines'; end if;
end $$;

-- F(협력업체 계정): 발주한 계약만
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
insert into public.contract (tenant_id, customer_id, contract_date, partner_id)
  values (:'t1', (select id from public.customer where name = '대구고객'), date '2026-09-23', (select id from public.partner limit 1));
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000006', false);
do $$ begin
  if (select count(*) from public.contract) <> 1 then raise exception 'partner should see its ordered contract only'; end if;
  if (select partner_id from public.contract) is null then raise exception 'wrong contract visible to partner'; end if;
end $$;

reset role;
select 'RLS contract tests passed' as result;
