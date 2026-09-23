-- 기반 스키마 RLS 격리 테스트. 실패하면 raise exception 으로 멈춘다.
-- 실행: psql ... -v ON_ERROR_STOP=1 -f supabase/tests/rls_foundation.sql
\set ON_ERROR_STOP on

-- 사용자 3명: A(사업체1 대표), B(사업체2 대표), C(사업체1 시공기사 own), D(사업체1 지점장 branch)
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'a@test.local', '{"display_name":"A 대표"}'),
  ('b0000000-0000-4000-8000-000000000002', 'b@test.local', '{"display_name":"B 대표"}'),
  ('c0000000-0000-4000-8000-000000000003', 'c@test.local', '{"display_name":"C 기사"}'),
  ('d0000000-0000-4000-8000-000000000004', 'd@test.local', '{"display_name":"D 지점장"}');

-- 프로필 트리거 확인
do $$ begin
  if (select count(*) from public.profile) <> 4 then raise exception 'profile trigger failed'; end if;
end $$;

-- A 로 로그인해 사업체1 생성
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select public.create_tenant('나노마스터', 'nanomaster') as t1 \gset
-- B 로 로그인해 사업체2 생성
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', false);
select public.create_tenant('엠제이컨', 'mjcon') as t2 \gset
reset role;

-- A: 지점 추가, C(기사)·D(지점장) 구성원 등록
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
insert into public.branch (tenant_id, code, name) values (:'t1', 'DG', '대구지점');
select id as b_dg from public.branch where tenant_id = :'t1' and code = 'DG' \gset
insert into public.membership (tenant_id, profile_id, role_id, scope, branch_id)
  values (:'t1', 'c0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'own', null);
insert into public.membership (tenant_id, profile_id, role_id, scope, branch_id)
  values (:'t1', 'd0000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'branch', :'b_dg');

do $$ begin
  if (select count(*) from public.tenant) <> 1 then raise exception 'A should see exactly 1 tenant'; end if;
  if (select count(*) from public.branch) <> 2 then raise exception 'A should see 2 branches of t1'; end if;
  if (select count(*) from public.membership) <> 3 then raise exception 'A should see 3 memberships'; end if;
  if (select count(*) from public.profile) <> 3 then raise exception 'A should see 3 profiles (own + members)'; end if;
  if (select count(*) from public.audit_log) < 3 then raise exception 'A (owner) should read audit log'; end if;
end $$;

-- B: 사업체2만 보이고 사업체1 은 안 보임
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', false);
do $$ begin
  if (select count(*) from public.tenant) <> 1 then raise exception 'B should see 1 tenant'; end if;
  if exists (select 1 from public.tenant where slug = 'nanomaster') then raise exception 'B must not see t1'; end if;
  if exists (select 1 from public.branch where code = 'DG') then raise exception 'B must not see t1 branches'; end if;
  if (select count(*) from public.profile) <> 1 then raise exception 'B should see only own profile'; end if;
  if exists (select 1 from public.audit_log where tenant_id <> (select id from public.tenant limit 1)) then
    raise exception 'B must not read t1 audit rows'; end if;
end $$;
-- B 가 사업체1 지점을 넣으려 하면 거부
do $$ begin
  begin
    insert into public.branch (tenant_id, code, name) values ('00000000-0000-0000-0000-000000000000', 'X', 'x');
    raise exception 'insert into unknown tenant must fail';
  exception when insufficient_privilege or foreign_key_violation then null; end;
end $$;
-- B 가 사업체1 지점을 UPDATE 하려 하면 0행 (보이지 않으므로)
update public.branch set name = 'hacked' where code = 'DG';
do $$ begin
  if exists (select 1 from public.branch where name = 'hacked') then raise exception 'cross-tenant update leaked'; end if;
end $$;

-- C(기사, own): 조회는 되지만 지점·구성원 수정 불가, 감사 로그 조회 불가
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.branch) <> 2 then raise exception 'C should see t1 branches'; end if;
  if (select count(*) from public.audit_log) <> 0 then raise exception 'C must not read audit log'; end if;
  begin
    insert into public.branch (tenant_id, code, name) values ((select id from public.tenant limit 1), 'BS', '부산');
    raise exception 'C must not insert branch';
  exception when insufficient_privilege then null; end;
  begin
    update public.membership set role_id = '10000000-0000-4000-8000-000000000001' where profile_id = auth.uid();
    if exists (select 1 from public.membership where profile_id = auth.uid() and role_id = '10000000-0000-4000-8000-000000000001') then
      raise exception 'C escalated to owner';
    end if;
  exception when insufficient_privilege then null; end;
end $$;

-- D(지점장, branch 범위): 구성원 관리 권한은 있지만 소유자 역할은 못 줌, 다른 지점 구성원은 못 고침
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000004', false);
do $$ begin
  begin
    update public.membership set role_id = '10000000-0000-4000-8000-000000000001' where profile_id = auth.uid();
    raise exception 'D must not grant owner';
  exception when insufficient_privilege then null; end;
  -- 본사 소속(지점 없음) C 의 역할 변경: branch 범위 밖이라 0행
  update public.membership set job_title = 'x' where profile_id = 'c0000000-0000-4000-8000-000000000003';
  if exists (select 1 from public.membership where job_title = 'x') then raise exception 'D changed member outside branch'; end if;
  -- 본인 지점 구성원 추가는 가능
  insert into public.membership (tenant_id, profile_id, role_id, scope, branch_id)
    select m.tenant_id, 'b0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'branch', m.branch_id
    from public.membership m where m.profile_id = auth.uid();
end $$;

-- 초대 흐름: A 가 새 이메일 초대 → 그 이메일 사용자가 수락
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
insert into public.invitation (tenant_id, email, role_id, scope) values (:'t1', 'e@test.local', '10000000-0000-4000-8000-000000000003', 'tenant');
select token as inv_token from public.invitation where email = 'e@test.local' \gset
reset role;
insert into auth.users (id, email) values ('e0000000-0000-4000-8000-000000000005', 'e@test.local');
set role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
select public.accept_invitation(:'inv_token');
do $$ begin
  if (select count(*) from public.tenant) <> 1 then raise exception 'E should now see t1'; end if;
  if (select count(*) from public.my_permissions((select id from public.tenant limit 1))) < 5 then raise exception 'E permissions missing'; end if;
end $$;
-- 잘못된 토큰
do $$ begin
  begin
    perform public.accept_invitation('nope');
    raise exception 'bad token accepted';
  exception when no_data_found or others then
    if sqlerrm like '%bad token accepted%' then raise; end if;
  end;
end $$;

-- anon 은 아무것도 못 봄
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if (select count(*) from public.tenant) <> 0 then raise exception 'anon must see nothing'; end if;
  if (select count(*) from public.role) <> 0 then raise exception 'anon must not see roles'; end if;
end $$;
reset role;

select 'RLS foundation tests passed' as result;
