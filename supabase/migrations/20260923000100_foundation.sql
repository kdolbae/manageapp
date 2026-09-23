-- =============================================================================
-- 집대리 기반 스키마 (D1, 2026-09-23)
--
-- 원칙
--  - 모든 업무 테이블은 tenant_id 를 가지며 RLS 로 사업체 간 격리한다.
--  - 권한 = 역할(role) × 범위(scope: own / branch / tenant / group).
--  - 하드 삭제 없음(deleted_at). 변경은 audit_log 에 남긴다.
--  - 헬퍼 함수는 app 스키마, 클라이언트가 호출하는 RPC 는 public 스키마.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;
grant usage on schema app to authenticated, anon, service_role;

-- -----------------------------------------------------------------------------
-- 1. 사업체 그룹 / 사업체 / 지점
-- -----------------------------------------------------------------------------
create table public.tenant_group (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);
comment on table public.tenant_group is '여러 사업체를 묶는 그룹(본사가 여러 사업을 운영할 때).';

create table public.tenant (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references public.tenant_group(id),
  slug         citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name         text not null,
  business_no  text,
  brand        jsonb not null default '{}'::jsonb,   -- 고객 페이지 브랜딩(앱 이름·로고·색)
  settings     jsonb not null default '{}'::jsonb,
  status       text not null default 'active' check (status in ('active','suspended','closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
comment on table public.tenant is '사업체 = 데이터 격리 단위. 새 사업은 새 사업체.';

create table public.branch (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  code        text not null,
  name        text not null,
  parent_id   uuid references public.branch(id),
  phone       text,
  address     text,
  is_hq       boolean not null default false,
  sort_order  int not null default 0,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (tenant_id, code)
);
create index branch_tenant_idx on public.branch (tenant_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- 2. 사람 (auth.users 1:1 프로필) / 부서 / 직위
-- -----------------------------------------------------------------------------
create table public.profile (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default '',
  phone         text,
  email         citext,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.department (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  branch_id   uuid references public.branch(id),
  parent_id   uuid references public.department(id),
  name        text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index department_tenant_idx on public.department (tenant_id);

create table public.job_position (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  name        text not null,
  rank        int not null default 0,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index position_tenant_idx on public.job_position (tenant_id);

-- -----------------------------------------------------------------------------
-- 3. 권한 카탈로그 / 역할 / 역할-권한
-- -----------------------------------------------------------------------------
create table public.permission_catalog (
  code        text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  module      text not null,
  label       text not null,
  sort_order  int not null default 0
);

create table public.role (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenant(id),          -- null = 시스템 기본 역할(모든 사업체 공용)
  code           text not null,
  name           text not null,
  description    text,
  default_scope  text not null default 'tenant' check (default_scope in ('own','branch','tenant','group')),
  is_system      boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index role_tenant_code_uq
  on public.role (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create table public.role_permission (
  role_id     uuid not null references public.role(id) on delete cascade,
  permission  text not null references public.permission_catalog(code),
  primary key (role_id, permission)
);

-- -----------------------------------------------------------------------------
-- 4. 구성원(사람 × 사업체 × 역할 × 범위) / 초대
-- -----------------------------------------------------------------------------
create table public.membership (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id),
  profile_id     uuid not null references public.profile(id),
  role_id        uuid not null references public.role(id),
  branch_id      uuid references public.branch(id),
  scope          text not null default 'tenant' check (scope in ('own','branch','tenant','group')),
  department_id  uuid references public.department(id),
  position_id    uuid references public.job_position(id),
  job_title      text,
  status         text not null default 'active' check (status in ('invited','active','suspended')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, profile_id),
  check (scope <> 'branch' or branch_id is not null)
);
create index membership_profile_idx on public.membership (profile_id) where status = 'active';

create table public.invitation (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id),
  email        citext not null,
  role_id      uuid not null references public.role(id),
  branch_id    uuid references public.branch(id),
  scope        text not null default 'tenant' check (scope in ('own','branch','tenant','group')),
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references public.profile(id),
  created_by   uuid references public.profile(id),
  created_at   timestamptz not null default now()
);
create index invitation_tenant_idx on public.invitation (tenant_id) where accepted_at is null;

-- -----------------------------------------------------------------------------
-- 5. 공통: 코드값 / 감사 로그 / 상태 이력
-- -----------------------------------------------------------------------------
create table public.code_value (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  domain      text not null,          -- 예: work_area, intake_type, pay_method
  code        text not null,
  label       text not null,
  color       text,                   -- 표식 색(작업 단위 등)
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, domain, code)
);

create table public.audit_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid,
  actor_id     uuid,
  action       text not null check (action in ('insert','update','delete')),
  table_name   text not null,
  row_id       text,
  before_data  jsonb,
  after_data   jsonb,
  at           timestamptz not null default now()
);
create index audit_log_tenant_at_idx on public.audit_log (tenant_id, at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id);

create table public.status_history (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenant(id),
  entity       text not null,         -- 예: contract, job, expense
  entity_id    uuid not null,
  from_status  text,
  to_status    text not null,
  actor_id     uuid,
  note         text,
  at           timestamptz not null default now()
);
create index status_history_entity_idx on public.status_history (entity, entity_id, at desc);

-- -----------------------------------------------------------------------------
-- 6. 헬퍼 함수 (app 스키마)
-- -----------------------------------------------------------------------------
create or replace function app.tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from public.membership
  where profile_id = auth.uid() and status = 'active'
$$;

create or replace function app.is_member(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.membership
    where tenant_id = tid and profile_id = auth.uid() and status = 'active')
$$;

create or replace function app.has_perm(tid uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.membership m
    join public.role_permission rp on rp.role_id = m.role_id
    where m.tenant_id = tid and m.profile_id = auth.uid()
      and m.status = 'active' and rp.permission = perm)
$$;

-- 행이 내 범위 안인가? (bid = 행의 지점, owner = 행의 담당자/작성자)
-- strict=false(조회): 지점 범위 사용자에게 지점 없는(본사 공통) 행도 보인다.
-- strict=true(수정): 지점 범위 사용자는 자기 지점 행만 고칠 수 있다.
create or replace function app.in_scope(tid uuid, bid uuid, owner uuid, strict boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.membership m
    where m.tenant_id = tid and m.profile_id = auth.uid() and m.status = 'active'
      and (m.scope in ('tenant','group')
        or (m.scope = 'branch' and ((bid is null and not strict) or m.branch_id = bid))
        or (m.scope = 'own' and owner = auth.uid())))
$$;

create or replace function app.is_owner(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.membership m
    join public.role r on r.id = m.role_id
    where m.tenant_id = tid and m.profile_id = auth.uid()
      and m.status = 'active' and r.code = 'owner' and r.tenant_id is null)
$$;

create or replace function app.group_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from public.tenant t
  where t.group_id is not null and t.group_id in (
    select t2.group_id from public.tenant t2
    join public.membership m on m.tenant_id = t2.id
    where m.profile_id = auth.uid() and m.status = 'active' and m.scope = 'group')
$$;

create or replace function app.touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j_old jsonb; j_new jsonb; tid uuid; rid text;
begin
  if tg_op <> 'INSERT' then j_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then j_new := to_jsonb(new); end if;
  tid := coalesce(
    (coalesce(j_new, j_old) ->> 'tenant_id')::uuid,
    case when tg_table_name = 'tenant' then (coalesce(j_new, j_old) ->> 'id')::uuid end);
  rid := coalesce(j_new, j_old) ->> 'id';
  insert into public.audit_log (tenant_id, actor_id, action, table_name, row_id, before_data, after_data)
  values (tid, auth.uid(), lower(tg_op), tg_table_name, rid, j_old, j_new);
  return coalesce(new, old);
end $$;

-- 소유자 역할 부여/변경은 소유자만
create or replace function app.guard_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  new_is_owner boolean;
  old_is_owner boolean := false;
begin
  if auth.uid() is null then return new; end if;  -- 서비스 키/마이그레이션 경로
  select (r.code = 'owner' and r.tenant_id is null) into new_is_owner
    from public.role r where r.id = new.role_id;
  if tg_op = 'UPDATE' then
    select (r.code = 'owner' and r.tenant_id is null) into old_is_owner
      from public.role r where r.id = old.role_id;
  end if;
  -- 첫 구성원(사업체 생성 시 대표 등록)은 허용
  if tg_op = 'INSERT' and new_is_owner
     and not exists (select 1 from public.membership where tenant_id = new.tenant_id) then
    return new;
  end if;
  if (new_is_owner or old_is_owner) and not app.is_owner(new.tenant_id) then
    raise exception 'only an owner can grant or change the owner role'
      using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id, email, display_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name',
             new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name',
             split_part(coalesce(new.email, ''), '@', 1)),
    new.phone)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- -----------------------------------------------------------------------------
-- 7. 트리거 부착
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tenant','branch','profile','department','job_position','role','membership','code_value']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['tenant','branch','department','job_position','role','role_permission','membership','invitation','code_value']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

create trigger membership_guard before insert or update on public.membership
  for each row execute function app.guard_membership();

-- -----------------------------------------------------------------------------
-- 8. RPC (public 스키마, 클라이언트 호출)
-- -----------------------------------------------------------------------------
-- 첫 사업체 만들기: 사업체 + 본사 지점 + 호출자 = 대표
create or replace function public.create_tenant(p_name text, p_slug text, p_group_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  owner_role uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_group_id is not null and p_group_id not in (
      select t.group_id from public.tenant t join public.membership m on m.tenant_id = t.id
      where m.profile_id = uid and m.status = 'active' and t.group_id is not null) then
    raise exception 'not a member of that group' using errcode = '42501';
  end if;
  select id into owner_role from public.role where tenant_id is null and code = 'owner';
  insert into public.tenant (name, slug, group_id) values (p_name, p_slug, p_group_id) returning id into tid;
  insert into public.branch (tenant_id, code, name, is_hq) values (tid, 'HQ', '본사', true);
  insert into public.membership (tenant_id, profile_id, role_id, scope, status)
  values (tid, uid, owner_role, 'tenant', 'active');
  return tid;
end $$;

-- 초대 수락: 토큰 + 로그인한 사람의 이메일이 맞으면 구성원으로 등록
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.invitation%rowtype;
  my_email citext;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into inv from public.invitation where token = p_token and accepted_at is null and expires_at > now();
  if not found then
    raise exception 'invitation not found or expired' using errcode = 'P0002';
  end if;
  select email into my_email from public.profile where id = uid;
  if my_email is distinct from inv.email then
    raise exception 'invitation was sent to a different email' using errcode = '42501';
  end if;
  insert into public.membership (tenant_id, profile_id, role_id, branch_id, scope, status)
  values (inv.tenant_id, uid, inv.role_id, inv.branch_id, inv.scope, 'active')
  on conflict (tenant_id, profile_id) do update
    set role_id = excluded.role_id, branch_id = excluded.branch_id, scope = excluded.scope, status = 'active';
  update public.invitation set accepted_at = now(), accepted_by = uid where id = inv.id;
  return inv.tenant_id;
end $$;

-- 내 권한 목록(화면 메뉴 구성용)
create or replace function public.my_permissions(p_tenant uuid)
returns setof text
language sql stable security definer set search_path = public as $$
  select distinct rp.permission
  from public.membership m
  join public.role_permission rp on rp.role_id = m.role_id
  where m.tenant_id = p_tenant and m.profile_id = auth.uid() and m.status = 'active'
$$;

-- -----------------------------------------------------------------------------
-- 9. RLS
-- -----------------------------------------------------------------------------
alter table public.tenant_group        enable row level security;
alter table public.tenant              enable row level security;
alter table public.branch              enable row level security;
alter table public.profile             enable row level security;
alter table public.department          enable row level security;
alter table public.job_position           enable row level security;
alter table public.permission_catalog  enable row level security;
alter table public.role                enable row level security;
alter table public.role_permission     enable row level security;
alter table public.membership          enable row level security;
alter table public.invitation          enable row level security;
alter table public.code_value          enable row level security;
alter table public.audit_log           enable row level security;
alter table public.status_history      enable row level security;

-- tenant_group: 내 사업체가 속한 그룹만
create policy tenant_group_select on public.tenant_group for select to authenticated
  using (id in (select t.group_id from public.tenant t where t.id in (select app.tenant_ids())));

-- tenant: 구성원이면 조회, 설정 권한이면 수정. 생성은 create_tenant RPC 로만.
create policy tenant_select on public.tenant for select to authenticated
  using (id in (select app.tenant_ids()) or id in (select app.group_tenant_ids()));
create policy tenant_update on public.tenant for update to authenticated
  using (app.has_perm(id, 'tenant.manage')) with check (app.has_perm(id, 'tenant.manage'));

-- branch
create policy branch_select on public.branch for select to authenticated
  using (app.is_member(tenant_id));
create policy branch_insert on public.branch for insert to authenticated
  with check (app.has_perm(tenant_id, 'branch.manage'));
create policy branch_update on public.branch for update to authenticated
  using (app.has_perm(tenant_id, 'branch.manage')) with check (app.has_perm(tenant_id, 'branch.manage'));

-- profile: 본인 + 같은 사업체 구성원의 프로필(이름 표시용)
create policy profile_select on public.profile for select to authenticated
  using (id = auth.uid()
      or id in (select m.profile_id from public.membership m where m.tenant_id in (select app.tenant_ids())));
create policy profile_update on public.profile for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- department / position / code_value: 구성원 조회, 설정 권한 수정
create policy department_select on public.department for select to authenticated using (app.is_member(tenant_id));
create policy department_write  on public.department for all to authenticated
  using (app.has_perm(tenant_id, 'tenant.manage')) with check (app.has_perm(tenant_id, 'tenant.manage'));
create policy position_select on public.job_position for select to authenticated using (app.is_member(tenant_id));
create policy position_write  on public.job_position for all to authenticated
  using (app.has_perm(tenant_id, 'tenant.manage')) with check (app.has_perm(tenant_id, 'tenant.manage'));
create policy code_value_select on public.code_value for select to authenticated using (app.is_member(tenant_id));
create policy code_value_write  on public.code_value for all to authenticated
  using (app.has_perm(tenant_id, 'tenant.manage')) with check (app.has_perm(tenant_id, 'tenant.manage'));

-- permission_catalog: 로그인한 누구나 조회
create policy permission_catalog_select on public.permission_catalog for select to authenticated using (true);

-- role: 시스템 역할은 모두 조회, 사업체 역할은 구성원만. 사업체 역할만 편집 가능.
create policy role_select on public.role for select to authenticated
  using (tenant_id is null or app.is_member(tenant_id));
create policy role_write on public.role for all to authenticated
  using (tenant_id is not null and app.has_perm(tenant_id, 'role.manage'))
  with check (tenant_id is not null and app.has_perm(tenant_id, 'role.manage'));

create policy role_permission_select on public.role_permission for select to authenticated
  using (exists (select 1 from public.role r where r.id = role_id and (r.tenant_id is null or app.is_member(r.tenant_id))));
create policy role_permission_write on public.role_permission for all to authenticated
  using (exists (select 1 from public.role r where r.id = role_id and r.tenant_id is not null and app.has_perm(r.tenant_id, 'role.manage')))
  with check (exists (select 1 from public.role r where r.id = role_id and r.tenant_id is not null and app.has_perm(r.tenant_id, 'role.manage')));

-- membership: 구성원 조회, 구성원 관리 권한 + 범위 안에서 수정
create policy membership_select on public.membership for select to authenticated
  using (app.is_member(tenant_id));
create policy membership_insert on public.membership for insert to authenticated
  with check (app.has_perm(tenant_id, 'member.manage') and app.in_scope(tenant_id, branch_id, profile_id, true));
create policy membership_update on public.membership for update to authenticated
  using (app.has_perm(tenant_id, 'member.manage') and app.in_scope(tenant_id, branch_id, profile_id, true))
  with check (app.has_perm(tenant_id, 'member.manage') and app.in_scope(tenant_id, branch_id, profile_id, true));
create policy membership_delete on public.membership for delete to authenticated
  using (app.has_perm(tenant_id, 'member.manage') and app.in_scope(tenant_id, branch_id, profile_id, true) and profile_id <> auth.uid());

-- invitation: 구성원 관리 권한
create policy invitation_all on public.invitation for all to authenticated
  using (app.has_perm(tenant_id, 'member.manage')) with check (app.has_perm(tenant_id, 'member.manage'));

-- audit_log: 감사 조회 권한만 조회. 쓰기는 트리거(security definer)만.
create policy audit_log_select on public.audit_log for select to authenticated
  using (tenant_id is not null and app.has_perm(tenant_id, 'audit.read'));

-- status_history: 구성원 조회·기록
create policy status_history_select on public.status_history for select to authenticated using (app.is_member(tenant_id));
create policy status_history_insert on public.status_history for insert to authenticated with check (app.is_member(tenant_id));

-- -----------------------------------------------------------------------------
-- 10. 시드: 권한 카탈로그 + 시스템 역할
-- -----------------------------------------------------------------------------
insert into public.permission_catalog (code, module, label, sort_order) values
  ('tenant.manage',    '설정',   '사업체 설정',            10),
  ('branch.manage',    '설정',   '지점 관리',              11),
  ('member.manage',    '설정',   '구성원 관리',            12),
  ('role.manage',      '설정',   '역할·권한 관리',         13),
  ('audit.read',       '설정',   '감사 로그 조회',         14),
  ('customer.read',    '사람',   '고객 조회',              20),
  ('customer.write',   '사람',   '고객 등록·수정',         21),
  ('technician.read',  '사람',   '시공자 조회',            22),
  ('technician.write', '사람',   '시공자 등록·수정',       23),
  ('partner.read',     '사람',   '협력업체 조회',          24),
  ('partner.write',    '사람',   '협력업체 등록·수정',     25),
  ('product.manage',   '상품',   '상품·단가 관리',         30),
  ('contract.read',    '계약',   '계약 조회',              40),
  ('contract.write',   '계약',   '계약 등록·수정',         41),
  ('contract.approve', '계약',   '계약 승인',              42),
  ('job.read',         '시공',   '시공 건 조회',           50),
  ('job.write',        '시공',   '시공 건 수정',           51),
  ('job.assign',       '시공',   '시공 배정',              52),
  ('job.complete',     '시공',   '시공 완료 처리',         53),
  ('ledger.read',      '수납',   '입금·원장 조회',         60),
  ('ledger.write',     '수납',   '입금·환불 기록',         61),
  ('ledger.void',      '수납',   '원장 취소',              62),
  ('payout.read',      '정산',   '기사 정산 조회',         70),
  ('payout.approve',   '정산',   '기사 정산 승인',         71),
  ('inquiry.read',     '문의',   '문의 조회',              80),
  ('inquiry.write',    '문의',   '문의 처리·상담 기록',    81),
  ('content.read',     '콘텐츠', '사진·후기 조회',         90),
  ('content.write',    '콘텐츠', '사진·후기 올리기',       91),
  ('content.publish',  '콘텐츠', '콘텐츠 발행',            92),
  ('inventory.read',   '자재',   '재고 조회',             100),
  ('inventory.move',   '자재',   '입고·출고·이동',        101),
  ('inventory.price',  '자재',   '단가 조회·수정',        102),
  ('inventory.force',  '자재',   '재고 초과 출고 승인',   103),
  ('expense.write',    '경비',   '경비 청구',             110),
  ('expense.approve',  '경비',   '경비 결재',             111),
  ('finance.read',     '재무',   '재무 현황 조회',        120),
  ('report.read',      '분석',   '영업 분석 조회',        130),
  ('monitor.read',     '모니터', '전체 모니터링',         131),
  ('notice.write',     '그룹웨어','공지 작성',            140),
  ('approval.write',   '그룹웨어','결재 상신',            141),
  ('approval.decide',  '그룹웨어','결재 승인·반려',       142),
  ('hr.manage',        '그룹웨어','조직·인사 관리',       143);

insert into public.role (id, tenant_id, code, name, description, default_scope, is_system, sort_order) values
  ('10000000-0000-4000-8000-000000000001', null, 'owner',          '대표',       '사업체 전체 권한',                        'tenant', true, 1),
  ('10000000-0000-4000-8000-000000000002', null, 'branch_manager', '지점장',     '지점 범위에서 계약·배정·수납·구성원 관리', 'branch', true, 2),
  ('10000000-0000-4000-8000-000000000003', null, 'staff',          '사무·상담',  '계약·시공·수납·문의 처리',                'tenant', true, 3),
  ('10000000-0000-4000-8000-000000000004', null, 'technician',     '시공기사',   '배정된 시공 건과 잔금 수납, 사진 올리기', 'own',    true, 4),
  ('10000000-0000-4000-8000-000000000005', null, 'sales',          '영업자',     '본인 고객·계약 등록',                     'own',    true, 5),
  ('10000000-0000-4000-8000-000000000006', null, 'partner',        '협력업체',   '발주(계약 요청)와 본인 건 조회',          'own',    true, 6),
  ('10000000-0000-4000-8000-000000000007', null, 'viewer',         '조회',       '조회만',                                  'tenant', true, 7);

-- 대표: 전체
insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000001', code from public.permission_catalog;
-- 지점장: 사업체·역할 설정 제외 전체
insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000002', code from public.permission_catalog
  where code not in ('tenant.manage','role.manage','branch.manage');
-- 사무·상담
insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000003', unnest(array[
    'customer.read','customer.write','technician.read','partner.read','partner.write',
    'contract.read','contract.write','job.read','job.write','job.assign',
    'ledger.read','ledger.write','inquiry.read','inquiry.write',
    'content.read','content.write','inventory.read','inventory.move',
    'expense.write','approval.write','monitor.read']);
-- 시공기사 (own 범위)
insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000004', unnest(array[
    'customer.read','contract.read','job.read','job.complete','ledger.read','ledger.write',
    'content.read','content.write','inventory.read','inventory.move','expense.write','approval.write']);
-- 영업자 (own 범위)
insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000005', unnest(array[
    'customer.read','customer.write','contract.read','contract.write','job.read',
    'ledger.read','inquiry.read','inquiry.write','content.read','content.write','report.read','expense.write','approval.write']);
-- 협력업체 (own 범위)
insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000006', unnest(array[
    'customer.write','contract.read','contract.write','job.read','content.read']);
-- 조회
insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000007', code from public.permission_catalog where code like '%.read';

-- -----------------------------------------------------------------------------
-- 11. 권한 부여
-- -----------------------------------------------------------------------------
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
grant execute on function public.create_tenant(text, text, uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
revoke execute on function public.create_tenant(text, text, uuid) from anon, public;
revoke execute on function public.accept_invitation(text) from anon, public;
revoke execute on function public.my_permissions(uuid) from anon, public;
