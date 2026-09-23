-- D2 RLS 테스트. rls_foundation.sql 을 먼저 실행한 상태(사용자 A~E, 사업체 t1·t2)에서 돌린다.
\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select id as b_dg from public.branch where tenant_id = :'t1' and code = 'DG' \gset

-- 기본 코드값이 시드됐는가
do $$ begin
  if (select count(*) from public.code_value where domain = 'work_area') <> 2 then raise exception 'work_area seed missing'; end if;
end $$;

-- A(대표): 고객·현장·시공자·협력업체·상품 등록
insert into public.partner (tenant_id, name, types) values (:'t1', '힐스테이트 분양사무소', '{orderer,referrer}');
select id as p1 from public.partner where name = '힐스테이트 분양사무소' \gset
insert into public.customer (tenant_id, name, phone, source_code, referrer_partner_id, owner_id)
  values (:'t1', '김서연', '010-1234-5678', 'partner', :'p1', 'a0000000-0000-4000-8000-000000000001');
select id as c1 from public.customer where name = '김서연' \gset
insert into public.customer (tenant_id, branch_id, name, phone, owner_id)
  values (:'t1', :'b_dg', '대구고객', '010-9999-0000', 'c0000000-0000-4000-8000-000000000003');
insert into public.site (tenant_id, customer_id, name, dong, ho) values (:'t1', :'c1', '래미안 원베일리', '108', '1502');
insert into public.technician (tenant_id, name, phone, profile_id, skills, bank_account)
  values (:'t1', 'C 기사', '010-3333-3333', 'c0000000-0000-4000-8000-000000000003', '{kitchen,bath}', '110-222-333333');
insert into public.technician (tenant_id, name, phone, branch_id) values (:'t1', '대구 기사', '010-4444-4444', :'b_dg');
insert into public.product_category (tenant_id, code, name) values (:'t1', 'COAT', '코팅');
select id as cat from public.product_category where code = 'COAT' \gset
insert into public.product (tenant_id, category_id, code, name, work_area_code, price, technician_rate)
  values (:'t1', :'cat', 'K-COAT', '주방 상판 코팅', 'kitchen', 980000, 250000);
select id as prod from public.product where code = 'K-COAT' \gset
insert into public.price_rule (tenant_id, product_id, partner_id, price, priority) values (:'t1', :'prod', :'p1', 880000, 10);

do $$ begin
  if (select phone from public.customer where name = '김서연') <> '01012345678' then raise exception 'phone not normalized'; end if;
  if (select price from public.effective_price((select id from public.product where code='K-COAT'))) <> 980000 then raise exception 'base price wrong'; end if;
  if (select price from public.effective_price((select id from public.product where code='K-COAT'), null, (select id from public.partner limit 1))) <> 880000 then raise exception 'partner price rule not applied'; end if;
end $$;

-- G(사업체2 에만 소속): 사업체1 데이터는 아무것도 안 보임
-- (B 는 기반 테스트에서 사업체1 대구지점 구성원으로도 등록됐으므로 여기서는 쓰지 않는다)
reset role;
insert into auth.users (id, email) values ('90000000-0000-4000-8000-000000000007', 'g@test.local');
set role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', false);
insert into public.membership (tenant_id, profile_id, role_id, scope)
  select id, '90000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000003', 'tenant' from public.tenant where slug = 'mjcon';
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.tenant) <> 1 then raise exception 'G should see 1 tenant'; end if;
  if (select count(*) from public.customer) <> 0 then raise exception 'G sees t1 customers'; end if;
  if (select count(*) from public.product) <> 0 then raise exception 'G sees t1 products'; end if;
  if (select count(*) from public.technician) <> 0 then raise exception 'G sees t1 technicians'; end if;
  if (select count(*) from public.code_value where domain = 'work_area') <> 2 then raise exception 'G should see own tenant code values'; end if;
end $$;

-- C(시공기사, own): 본인 시공자 행만, 고객은 본인 담당만, 상품은 조회 가능, 고객 등록 불가
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.technician) <> 1 then raise exception 'C should see only own technician row'; end if;
  if (select count(*) from public.customer) <> 1 then raise exception 'C should see only own customer'; end if;
  if (select count(*) from public.product) <> 1 then raise exception 'C should read products'; end if;
  -- 기사는 contract.read 가 있어 판매 가격 규칙은 볼 수 있지만, 기사별 단가표는 본인 것만
  if (select count(*) from public.price_rule) <> 1 then raise exception 'C should read price rules (has contract.read)'; end if;
  if (select count(*) from public.technician_rate) <> 0 then raise exception 'C should see no technician_rate rows yet'; end if;
  begin
    insert into public.customer (tenant_id, name) values ((select id from public.tenant limit 1), '몰래');
    raise exception 'C must not insert customer';
  exception when insufficient_privilege then null; end;
end $$;

-- D(지점장 DG, branch): 대구 고객·기사 + 본사 공통(지점 없음) 조회, 다른 지점 없음. 지점 없는 고객 수정은 불가.
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000004', false);
do $$ begin
  if (select count(*) from public.customer) <> 2 then raise exception 'D should see branch + hq-common customers'; end if;
  update public.customer set memo = 'x' where name = '김서연';
  if exists (select 1 from public.customer where memo = 'x') then raise exception 'D changed hq customer'; end if;
  update public.customer set memo = 'y' where name = '대구고객';
  if not exists (select 1 from public.customer where memo = 'y') then raise exception 'D could not change own-branch customer'; end if;
end $$;

-- 협력업체 계정: 구성원에 partner_id 연결 → 자기 소개 고객과 자기 회사만
reset role;
insert into auth.users (id, email) values ('f0000000-0000-4000-8000-000000000006', 'f@partner.local');
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
insert into public.membership (tenant_id, profile_id, role_id, scope, partner_id)
  values (:'t1', 'f0000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', 'own', :'p1');
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000006', false);
do $$ begin
  if (select count(*) from public.customer) <> 1 then raise exception 'partner user should see referred customer only'; end if;
  if (select name from public.customer) <> '김서연' then raise exception 'wrong customer visible to partner'; end if;
  if (select count(*) from public.partner) <> 1 then raise exception 'partner user should see own company'; end if;
  if (select count(*) from public.technician) <> 0 then raise exception 'partner must not see technicians'; end if;
end $$;

reset role;
select 'RLS parties/products tests passed' as result;
