-- =============================================================================
-- D13: 집대리 플랫폼 층 — 협력업체 신청·심사, 업체 소개(노출), 고객 요청·견적·대화, 수수료·정산, 광고(상단 노출)
--  - 운영사(집대리) = platform.operator_tenant_id 인 사업체. 그 구성원 중 platform.manage 권한자가 운영자.
--  - 협력업체 = 승인되면 자기 사업체(tenant)가 생겨 계약·시공 관리 프로그램을 그대로 쓴다. 노출 정보는 vendor_profile.
--  - 고객은 로그인 없이 요청을 올리고 비밀 링크(token)로 견적을 비교·선택·대화한다. 업체에는 이름 일부·단지까지만 보이고
--    전화번호는 고객이 선택한 업체에 한해, 고객이 공개를 켰을 때만 보인다 (market_request 뷰).
--  - 수수료는 업체별 설정(건당 정액/계약금액 %)으로 기간 정산서(platform_settlement)를 만든다. 결제(PG)는 다음 단계.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 권한 코드
-- -----------------------------------------------------------------------------
insert into public.permission_catalog (code, module, label, sort_order) values
  ('platform.manage', '플랫폼', '집대리 운영(심사·수수료·정산·광고)', 150),
  ('market.read',     '마켓',   '요청·견적 조회',                     160),
  ('market.write',    '마켓',   '견적 제출·대화·업체 소개 편집',      161),
  ('market.settle',   '마켓',   '플랫폼 정산 조회',                   162)
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000001'::uuid, unnest(array['platform.manage','market.read','market.write','market.settle'])
union all
  select '10000000-0000-4000-8000-000000000002'::uuid, unnest(array['market.read','market.write','market.settle'])
union all
  select '10000000-0000-4000-8000-000000000003'::uuid, unnest(array['market.read','market.write'])
union all
  select '10000000-0000-4000-8000-000000000005'::uuid, unnest(array['market.read','market.write'])
union all
  select '10000000-0000-4000-8000-000000000007'::uuid, unnest(array['market.read'])
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. 운영사 · 서비스 분류
-- -----------------------------------------------------------------------------
create table public.platform (
  id                  int primary key default 1 check (id = 1),
  operator_tenant_id  uuid not null unique references public.tenant(id),
  name                text not null default '집대리',
  settings            jsonb not null default '{}'::jsonb,   -- 기본 수수료율, 광고 단가 등
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.platform is '집대리 운영사 지정(한 행). 운영사 구성원 중 platform.manage 권한자가 심사·정산·광고를 다룬다.';

create table public.platform_category (
  code        text primary key check (code ~ '^[a-z_]+$'),
  label       text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true
);
insert into public.platform_category (code, label, sort_order) values
  ('cleaning', '입주 청소',        1),
  ('coating',  '코팅(나노·유리막)', 2),
  ('grout',    '줄눈',             3),
  ('film',     '필름·시트',        4),
  ('blind',    '블라인드·커튼',    5),
  ('aircon',   '에어컨 설치·청소', 6),
  ('pest',     '방역·새집증후군',  7),
  ('moving',   '이사',             8),
  ('interior', '인테리어·수리',    9),
  ('other',    '기타',            99);

create or replace function app.platform_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select operator_tenant_id from public.platform where id = 1
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select app.has_perm(operator_tenant_id, 'platform.manage') from public.platform where id = 1), false)
$$;

-- 내가 요청·견적을 볼 수 있는 사업체들 (market.read)
create or replace function app.market_tenants() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct m.tenant_id from public.membership m
  join public.role_permission rp on rp.role_id = m.role_id
  where m.profile_id = auth.uid() and m.status = 'active' and rp.permission = 'market.read'
$$;

-- 권한자에게 앱 내 알림
create or replace function app.notify_members(tid uuid, perm text, kind text, title text, body text, link text) returns void
language sql security definer set search_path = public as $$
  insert into public.inapp_notification (tenant_id, profile_id, kind, title, body, link)
  select distinct tid, m.profile_id, kind, title, body, link
  from public.membership m join public.role_permission rp on rp.role_id = m.role_id
  where m.tenant_id = tid and m.status = 'active' and rp.permission = perm
$$;

create or replace function app.notify_platform_admins(kind text, title text, body text, link text) returns void
language sql security definer set search_path = public as $$
  select app.notify_members(operator_tenant_id, 'platform.manage', kind, title, body, link) from public.platform where id = 1
$$;

-- 운영사 지정: 아직 없을 때 그 사업체 대표만 (한 번)
create or replace function public.claim_platform_operator(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_owner(p_tenant) then raise exception '사업체 대표만 운영사로 지정할 수 있습니다' using errcode = '42501'; end if;
  if exists (select 1 from public.platform where id = 1) then raise exception '운영사가 이미 지정되어 있습니다' using errcode = '42501'; end if;
  insert into public.platform (id, operator_tenant_id) values (1, p_tenant);
end $$;

-- -----------------------------------------------------------------------------
-- 3. 협력업체 신청 · 업체 소개 · 수수료 설정
-- -----------------------------------------------------------------------------
create table public.vendor_application (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  business_no    text,
  ceo_name       text,
  phone          text not null,
  email          citext not null,
  address        text,
  regions        text[] not null default '{}',   -- 시공 가능 지역 (예: 대구, 경북 구미)
  categories     text[] not null default '{}',   -- platform_category.code
  intro          text,
  website        text,
  slug_wanted    text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note    text,
  reviewed_by    uuid references public.profile(id),
  reviewed_at    timestamptz,
  tenant_id      uuid references public.tenant(id),
  invitation_id  uuid references public.invitation(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index vendor_application_status_idx on public.vendor_application (status, created_at desc);

create table public.vendor_profile (
  tenant_id      uuid primary key references public.tenant(id),
  categories     text[] not null default '{}',
  regions        text[] not null default '{}',
  intro          text,
  highlights     text[] not null default '{}',   -- 한 줄 강점 (예: 당일 견적, 10년 경력)
  logo_path      text,                           -- Storage media 버킷 경로
  cover_path     text,
  min_price      numeric(14,0),
  response_note  text,                           -- 예: 평일 1시간 안에 답변
  is_listed      boolean not null default false, -- 운영자가 켠다
  listed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.platform_fee (
  tenant_id     uuid primary key references public.tenant(id),
  fee_type      text not null default 'percent' check (fee_type in ('percent','fixed','none')),
  rate          numeric(6,3) not null default 10,      -- percent 일 때 %
  fixed_amount  numeric(14,0) not null default 0,      -- fixed 일 때 건당 금액
  min_fee       numeric(14,0),
  max_fee       numeric(14,0),
  cycle         text not null default 'monthly' check (cycle in ('monthly','per_case')),
  memo          text,
  updated_by    uuid references public.profile(id),
  updated_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. 고객 요청 · 견적 · 대화
-- -----------------------------------------------------------------------------
create table public.service_request (
  id                  uuid primary key default gen_random_uuid(),
  token               text not null unique default encode(gen_random_bytes(16), 'hex'),
  name                text not null,
  phone               text not null,                 -- 숫자만. 업체에는 뷰로만 노출
  email               citext,
  region              text not null,                 -- 예: 대구 수성구
  apt                 text,                          -- 단지명
  address             text,                          -- 동·호수 등. 선택된 업체에만
  area_pyeong         int,
  move_in_date        date,
  categories          text[] not null default '{}',
  message             text,
  budget              numeric(14,0),
  directed_tenant_id  uuid references public.tenant(id),   -- 특정 업체에게만 보낸 요청
  external_id         text,                                 -- 외부 회원 식별자 (예: 'jipdarie:<userId>' 집대리 소비자 앱)
  status              text not null default 'open' check (status in ('open','accepted','closed','canceled')),
  accepted_quote_id   uuid,
  phone_shared        boolean not null default false,      -- 고객이 선택 업체에 전화번호 공개
  utm                 jsonb not null default '{}'::jsonb,
  expires_at          timestamptz not null default now() + interval '14 days',
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index service_request_status_idx on public.service_request (status, created_at desc);
create index service_request_external_idx on public.service_request (external_id, created_at desc) where external_id is not null;

create table public.quote (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references public.service_request(id) on delete cascade,
  tenant_id       uuid not null references public.tenant(id),
  amount          numeric(14,0) not null check (amount >= 0),
  items           jsonb not null default '[]'::jsonb,   -- [{name, qty, unit_price}]
  message         text,
  available_from  date,
  valid_until     date,
  status          text not null default 'submitted' check (status in ('submitted','accepted','declined','withdrawn')),
  contract_id     uuid references public.contract(id),
  created_by      uuid references public.profile(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (request_id, tenant_id)
);
create index quote_tenant_idx on public.quote (tenant_id, created_at desc);
alter table public.service_request add constraint service_request_accepted_fk foreign key (accepted_quote_id) references public.quote(id);
alter table public.contract add column platform_quote_id uuid references public.quote(id);
create index contract_platform_quote_idx on public.contract (platform_quote_id) where platform_quote_id is not null;

create table public.request_message (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.service_request(id) on delete cascade,
  tenant_id   uuid not null references public.tenant(id),      -- 대화 상대 업체 (요청 × 업체 = 한 대화방)
  sender      text not null check (sender in ('customer','vendor','platform')),
  sender_id   uuid references public.profile(id),
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index request_message_thread_idx on public.request_message (request_id, tenant_id, created_at);

-- 요청이 이 업체에 보이는가: 견적을 냈거나, 지목된 업체거나, (열려 있고) 분류·지역이 맞는 노출 업체
create or replace function app.request_visible(rid uuid, tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.service_request r
    left join public.vendor_profile vp on vp.tenant_id = tid
    where r.id = rid
      and (exists (select 1 from public.quote q where q.request_id = r.id and q.tenant_id = tid)
           or r.directed_tenant_id = tid
           or (r.directed_tenant_id is null and r.status = 'open' and r.expires_at > now()
               and vp.is_listed and vp.categories && r.categories
               and (coalesce(array_length(vp.regions, 1), 0) = 0
                    or exists (select 1 from unnest(vp.regions) g where r.region like g || '%')))))
$$;

-- 업체가 보는 요청 (이름 가림, 연락처는 선택된 업체 + 고객 동의 때만). 뷰 소유자 권한으로 돌고 where 로 걸러진다.
create or replace view public.market_request with (security_barrier = true) as
select r.id, r.created_at, r.updated_at, r.status, r.region, r.apt, r.area_pyeong, r.move_in_date, r.categories, r.message, r.budget,
       r.expires_at, r.directed_tenant_id, r.accepted_quote_id, acc.tenant_id as accepted_tenant_id,
       app.mask_name(r.name) as name_masked,
       case when acc.tenant_id in (select app.market_tenants()) then r.name end as contact_name,
       case when acc.tenant_id in (select app.market_tenants()) and r.phone_shared then r.phone end as contact_phone,
       case when acc.tenant_id in (select app.market_tenants()) then coalesce(r.address, r.apt) end as contact_address
from public.service_request r
left join public.quote acc on acc.id = r.accepted_quote_id
where app.is_platform_admin() or exists (select 1 from app.market_tenants() t where app.request_visible(r.id, t));
grant select on public.market_request to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. 광고(상단 노출) · 정산
-- -----------------------------------------------------------------------------
create table public.vendor_promotion (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant(id),
  kind                  text not null default 'featured' check (kind in ('featured','banner')),
  placement             text not null default 'home' check (placement in ('home','category')),
  category_code         text references public.platform_category(code),
  starts_on             date not null,
  ends_on               date not null,
  price                 numeric(14,0),                 -- 운영자가 승인하며 확정
  status                text not null default 'requested' check (status in ('requested','approved','rejected','canceled')),
  note                  text,
  requested_by          uuid references public.profile(id),
  decided_by            uuid references public.profile(id),
  decided_at            timestamptz,
  billed_settlement_id  uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index vendor_promotion_tenant_idx on public.vendor_promotion (tenant_id, starts_on desc);

create table public.platform_settlement (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  period_from   date not null,
  period_to     date not null,
  status        text not null default 'draft' check (status in ('draft','issued','paid','void')),
  fee_total     numeric(14,0) not null default 0,
  ad_total      numeric(14,0) not null default 0,
  adjust_total  numeric(14,0) not null default 0,
  total         numeric(14,0) not null default 0,
  issued_at     timestamptz,
  paid_at       timestamptz,
  memo          text,
  created_by    uuid references public.profile(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_to >= period_from)
);
create index platform_settlement_tenant_idx on public.platform_settlement (tenant_id, period_from desc);

create table public.platform_settlement_line (
  id             uuid primary key default gen_random_uuid(),
  settlement_id  uuid not null references public.platform_settlement(id) on delete cascade,
  tenant_id      uuid not null references public.tenant(id),
  kind           text not null check (kind in ('fee','ad','adjust')),
  ref_type       text,                       -- contract | promotion
  ref_id         uuid,
  description    text not null,
  basis_amount   numeric(14,0) not null default 0,
  fee_amount     numeric(14,0) not null default 0,
  created_at     timestamptz not null default now()
);
create index platform_settlement_line_idx on public.platform_settlement_line (settlement_id);
alter table public.vendor_promotion add constraint vendor_promotion_billed_fk foreign key (billed_settlement_id) references public.platform_settlement(id);

-- 노출 업체 카드 (디렉터리·고객 견적 비교용). 노출 켜진 업체의 공개 정보만
create or replace view public.vendor_card as
select t.id as tenant_id, t.slug, t.name, t.brand, vp.categories, vp.regions, vp.intro, vp.highlights, vp.logo_path, vp.cover_path,
       vp.min_price, vp.response_note, vp.listed_at,
       (select round(avg(r.rating)::numeric, 1) from public.review r where r.tenant_id = t.id and r.status = 'approved' and r.deleted_at is null) as rating,
       (select count(*) from public.review r where r.tenant_id = t.id and r.status = 'approved' and r.deleted_at is null) as review_count,
       (select count(*) from public.job j where j.tenant_id = t.id and j.status = 'done' and j.deleted_at is null) as done_jobs,
       exists (select 1 from public.vendor_promotion p where p.tenant_id = t.id and p.status = 'approved' and p.kind = 'featured'
               and current_date between p.starts_on and p.ends_on) as featured
from public.tenant t
join public.vendor_profile vp on vp.tenant_id = t.id
where vp.is_listed and t.status = 'active' and t.deleted_at is null;


-- 운영자용 업체 목록 (노출 전 업체 포함, 사업체 이름·수수료·초대 상태). 운영자만 행이 보인다
create or replace view public.platform_vendor with (security_barrier = true) as
select t.id as tenant_id, t.slug, t.name, t.status as tenant_status, t.business_no, t.brand, t.created_at as tenant_created_at,
       vp.categories, vp.regions, vp.intro, vp.highlights, vp.is_listed, vp.listed_at, vp.updated_at,
       f.fee_type, f.rate, f.fixed_amount, f.min_fee, f.max_fee, f.cycle, f.memo as fee_memo,
       (select count(*) from public.quote q where q.tenant_id = t.id) as quote_count,
       (select count(*) from public.quote q where q.tenant_id = t.id and q.status = 'accepted') as accepted_count,
       (select count(*) from public.membership m where m.tenant_id = t.id and m.status = 'active') as member_count,
       (select i.email::text from public.invitation i where i.tenant_id = t.id and i.accepted_at is null and i.expires_at > now() order by i.created_at desc limit 1) as pending_invite_email,
       (select i.token from public.invitation i where i.tenant_id = t.id and i.accepted_at is null and i.expires_at > now() order by i.created_at desc limit 1) as pending_invite_token
from public.tenant t
join public.vendor_profile vp on vp.tenant_id = t.id
left join public.platform_fee f on f.tenant_id = t.id
where app.is_platform_admin() and t.deleted_at is null;
grant select on public.platform_vendor to authenticated;

-- -----------------------------------------------------------------------------
-- 6. 공통 트리거 (updated_at · 감사 로그)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['platform','vendor_application','vendor_profile','platform_fee','service_request','quote','vendor_promotion','platform_settlement'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['vendor_application','vendor_profile','platform_fee','quote','vendor_promotion','platform_settlement','platform_settlement_line'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7. 업무 규칙 트리거
-- -----------------------------------------------------------------------------
-- 신청 접수 → 운영자 알림
create or replace function app.vendor_application_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.notify_platform_admins('vendor.applied', '협력업체 신청: ' || new.name, left(coalesce(new.intro, ''), 120), '/platform/applications');
  return new;
end $$;
create trigger vendor_application_after_insert after insert on public.vendor_application for each row execute function app.vendor_application_after_insert();

-- 업체 소개: 노출 여부는 운영자만 켠다
create or replace function app.vendor_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or app.is_platform_admin() then
    if new.is_listed and (tg_op = 'INSERT' or not old.is_listed) then new.listed_at := now(); end if;
    return new;
  end if;
  if tg_op = 'INSERT' then new.is_listed := false; new.listed_at := null;
  elsif new.is_listed is distinct from old.is_listed then
    raise exception '노출 여부는 집대리 운영자가 정합니다' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger vendor_profile_guard before insert or update on public.vendor_profile for each row execute function app.vendor_profile_guard();

-- 새 요청 → 맞는 업체들의 구성원(market.read)에게 알림
create or replace function app.service_request_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v record; title text;
begin
  title := '새 견적 요청 · ' || new.region || coalesce(' ' || new.apt, '');
  for v in select vp.tenant_id from public.vendor_profile vp
           where vp.is_listed and (new.directed_tenant_id = vp.tenant_id
                 or (new.directed_tenant_id is null and vp.categories && new.categories
                     and (coalesce(array_length(vp.regions, 1), 0) = 0 or exists (select 1 from unnest(vp.regions) g where new.region like g || '%'))))
  loop
    perform app.notify_members(v.tenant_id, 'market.read', 'request.new', title, left(coalesce(new.message, ''), 120), '/market/requests/' || new.id);
  end loop;
  return new;
end $$;
create trigger service_request_after_insert after insert on public.service_request for each row execute function app.service_request_after_insert();

create or replace function app.service_request_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.phone := app.norm_phone(new.phone);
  if new.status in ('closed','canceled') and (tg_op = 'INSERT' or old.status not in ('closed','canceled')) then new.closed_at := now(); end if;
  return new;
end $$;
create trigger service_request_before_write before insert or update on public.service_request for each row execute function app.service_request_before_write();

-- 견적: 업체는 제출·수정·철회만. 채택·탈락은 고객(서비스 키 함수)이 정한다
create or replace function app.quote_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    select * into r from public.service_request where id = new.request_id;
    if r.status <> 'open' or r.expires_at <= now() then raise exception '마감된 요청입니다' using errcode = '42501'; end if;
    if auth.uid() is not null and new.status <> 'submitted' then new.status := 'submitted'; end if;
    return new;
  end if;
  if auth.uid() is null then return new; end if;
  if new.status is distinct from old.status then
    if not (old.status = 'submitted' and new.status = 'withdrawn') then
      raise exception '견적 채택은 고객이 정합니다' using errcode = '42501';
    end if;
  end if;
  if old.status <> 'submitted' and (new.amount <> old.amount or new.items <> old.items) then
    raise exception '채택·마감된 견적은 고칠 수 없습니다' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger quote_guard before insert or update on public.quote for each row execute function app.quote_guard();

-- 대화: 고객 글은 업체 구성원에게 알림
create or replace function app.request_message_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sender = 'customer' then
    perform app.notify_members(new.tenant_id, 'market.write', 'message.new', '고객 메시지', left(new.body, 120), '/market/requests/' || new.request_id);
  end if;
  return new;
end $$;
create trigger request_message_after_insert after insert on public.request_message for each row execute function app.request_message_after_insert();

-- 광고: 업체는 신청·취소만, 승인·반려·금액은 운영자
create or replace function app.vendor_promotion_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.requested_by := coalesce(new.requested_by, auth.uid());
    if not app.is_platform_admin() then new.status := 'requested'; new.price := null; new.decided_by := null; new.decided_at := null; end if;
    return new;
  end if;
  if auth.uid() is null then return new; end if;
  if app.is_platform_admin() then
    if new.status is distinct from old.status and new.status in ('approved','rejected') then new.decided_by := auth.uid(); new.decided_at := now(); end if;
    return new;
  end if;
  if new.status is distinct from old.status and not (old.status = 'requested' and new.status = 'canceled') then
    raise exception '광고 승인은 집대리 운영자가 합니다' using errcode = '42501';
  end if;
  if new.price is distinct from old.price then raise exception '광고 금액은 운영자가 정합니다' using errcode = '42501'; end if;
  return new;
end $$;
create trigger vendor_promotion_guard before insert or update on public.vendor_promotion for each row execute function app.vendor_promotion_guard();

create or replace function app.vendor_promotion_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved','rejected') and old.status = 'requested' then
    perform app.notify_members(new.tenant_id, 'market.write', 'promotion.decided',
      case when new.status = 'approved' then '상단 노출 승인' else '상단 노출 반려' end || ' · ' || to_char(new.starts_on, 'MM.DD') || '~' || to_char(new.ends_on, 'MM.DD'),
      coalesce(new.note, ''), '/market/promotions');
  end if;
  return new;
end $$;
create trigger vendor_promotion_after_update after update on public.vendor_promotion for each row execute function app.vendor_promotion_after_update();

-- 정산: 합계 자동, 발행 뒤 항목 고정, 발행 알림
create or replace function app.settlement_recalc(sid uuid) returns void
language sql security definer set search_path = public as $$
  update public.platform_settlement s set
    fee_total    = coalesce((select sum(fee_amount) from public.platform_settlement_line l where l.settlement_id = s.id and l.kind = 'fee'), 0),
    ad_total     = coalesce((select sum(fee_amount) from public.platform_settlement_line l where l.settlement_id = s.id and l.kind = 'ad'), 0),
    adjust_total = coalesce((select sum(fee_amount) from public.platform_settlement_line l where l.settlement_id = s.id and l.kind = 'adjust'), 0),
    total        = coalesce((select sum(fee_amount) from public.platform_settlement_line l where l.settlement_id = s.id), 0)
  where s.id = sid
$$;

create or replace function app.settlement_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce(new.settlement_id, old.settlement_id);
begin
  if (select status from public.platform_settlement where id = sid) <> 'draft' then
    raise exception '발행된 정산서의 항목은 고칠 수 없습니다' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger settlement_line_guard before insert or update or delete on public.platform_settlement_line for each row execute function app.settlement_line_guard();

create or replace function app.settlement_line_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.settlement_recalc(case when tg_op = 'DELETE' then old.settlement_id else new.settlement_id end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger settlement_line_after after insert or update or delete on public.platform_settlement_line for each row execute function app.settlement_line_after();

create or replace function app.settlement_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'issued' then new.issued_at := now(); end if;
    if new.status = 'paid' then new.paid_at := now(); end if;
    if old.status = 'paid' and new.status <> 'void' then raise exception '입금 처리된 정산서입니다' using errcode = '42501'; end if;
  end if;
  return new;
end $$;
create trigger settlement_before_update before update on public.platform_settlement for each row execute function app.settlement_before_update();

create or replace function app.settlement_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'issued' and old.status = 'draft' then
    perform app.notify_members(new.tenant_id, 'market.settle', 'settlement.issued',
      '집대리 정산서 ' || to_char(new.period_from, 'YYYY.MM.DD') || '~' || to_char(new.period_to, 'MM.DD'),
      '합계 ' || to_char(new.total, 'FM999,999,999') || '원', '/market/settlements');
  end if;
  return new;
end $$;
create trigger settlement_after_update after update on public.platform_settlement for each row execute function app.settlement_after_update();

-- -----------------------------------------------------------------------------
-- 8. 코드값: 접수 형태·유입 경로에 '집대리 플랫폼'
-- -----------------------------------------------------------------------------
insert into public.code_value (tenant_id, domain, code, label, sort_order)
  select id, 'intake_type', 'platform', '집대리 플랫폼', 8 from public.tenant
union all
  select id, 'customer_source', 'platform', '집대리 플랫폼', 7 from public.tenant
on conflict (tenant_id, domain, code) do nothing;

create or replace function app.tenant_seed_platform() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.code_value (tenant_id, domain, code, label, sort_order) values
    (new.id, 'intake_type', 'platform', '집대리 플랫폼', 8),
    (new.id, 'customer_source', 'platform', '집대리 플랫폼', 7)
  on conflict (tenant_id, domain, code) do nothing;
  return new;
end $$;
create trigger tenant_seed_platform after insert on public.tenant for each row execute function app.tenant_seed_platform();

-- -----------------------------------------------------------------------------
-- 9. RPC — 운영자
-- -----------------------------------------------------------------------------
-- 신청 승인: 사업체 생성 + 업체 소개 + 대표 초대 링크. 신청자는 초대 링크로 가입하면 대표가 된다
create or replace function public.approve_vendor(p_application uuid, p_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.vendor_application%rowtype; tid uuid; inv_id uuid; inv_token text; owner_role uuid;
begin
  if not app.is_platform_admin() then raise exception '집대리 운영자만 승인할 수 있습니다' using errcode = '42501'; end if;
  select * into a from public.vendor_application where id = p_application for update;
  if a.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.status <> 'pending' then raise exception '이미 처리된 신청입니다' using errcode = '42501'; end if;
  select id into owner_role from public.role where tenant_id is null and code = 'owner';
  insert into public.tenant (name, slug, business_no, brand)
  values (a.name, p_slug, a.business_no, jsonb_build_object('phone', a.phone, 'address', a.address))
  returning id into tid;
  insert into public.branch (tenant_id, code, name, is_hq, phone, address) values (tid, 'HQ', '본사', true, a.phone, a.address);
  perform app.seed_tenant_defaults(tid);
  insert into public.vendor_profile (tenant_id, categories, regions, intro) values (tid, a.categories, a.regions, a.intro);
  insert into public.platform_fee (tenant_id, updated_by) values (tid, auth.uid());
  insert into public.invitation (tenant_id, email, role_id, scope, expires_at, created_by)
  values (tid, a.email, owner_role, 'tenant', now() + interval '30 days', auth.uid())
  returning id, token into inv_id, inv_token;
  update public.vendor_application set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), tenant_id = tid, invitation_id = inv_id
  where id = a.id;
  return jsonb_build_object('tenant_id', tid, 'invitation_token', inv_token, 'email', a.email);
end $$;

-- 정산서 만들기: 기간 안 계약일의 플랫폼 계약(견적 → 계약) 수수료 + 기간 시작 광고. 이미 정산된 건은 뺀다
create or replace function public.build_platform_settlement(p_tenant uuid, p_from date, p_to date) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; f public.platform_fee%rowtype; c record; p record; fee numeric;
begin
  if not app.is_platform_admin() then raise exception '집대리 운영자만 정산서를 만들 수 있습니다' using errcode = '42501'; end if;
  select * into f from public.platform_fee where tenant_id = p_tenant;
  if f.tenant_id is null then
    insert into public.platform_fee (tenant_id, updated_by) values (p_tenant, auth.uid()) returning * into f;
  end if;
  insert into public.platform_settlement (tenant_id, period_from, period_to, created_by) values (p_tenant, p_from, p_to, auth.uid()) returning id into sid;
  for c in select cs.id, cs.contract_no, cs.customer_name, cs.sale_total, cs.contract_date
           from public.contract_summary cs
           where cs.tenant_id = p_tenant and cs.partner_id is null and cs.canceled_at is null
             and cs.contract_date between p_from and p_to
             and exists (select 1 from public.contract ct where ct.id = cs.id and ct.platform_quote_id is not null)
             and not exists (select 1 from public.platform_settlement_line l join public.platform_settlement s on s.id = l.settlement_id
                             where l.ref_type = 'contract' and l.ref_id = cs.id and s.status <> 'void')
           order by cs.contract_date, cs.contract_no
  loop
    fee := case f.fee_type when 'percent' then round(c.sale_total * f.rate / 100) when 'fixed' then f.fixed_amount else 0 end;
    if f.min_fee is not null and fee < f.min_fee then fee := f.min_fee; end if;
    if f.max_fee is not null and fee > f.max_fee then fee := f.max_fee; end if;
    insert into public.platform_settlement_line (settlement_id, tenant_id, kind, ref_type, ref_id, description, basis_amount, fee_amount)
    values (sid, p_tenant, 'fee', 'contract', c.id, c.contract_no || ' ' || app.mask_name(c.customer_name) || ' (' || to_char(c.contract_date, 'MM.DD') || ')', c.sale_total, fee);
  end loop;
  for p in select * from public.vendor_promotion v
           where v.tenant_id = p_tenant and v.status = 'approved' and v.billed_settlement_id is null and v.price is not null
             and v.starts_on between p_from and p_to
  loop
    insert into public.platform_settlement_line (settlement_id, tenant_id, kind, ref_type, ref_id, description, basis_amount, fee_amount)
    values (sid, p_tenant, 'ad', 'promotion', p.id, '상단 노출 ' || to_char(p.starts_on, 'MM.DD') || '~' || to_char(p.ends_on, 'MM.DD'), p.price, p.price);
    update public.vendor_promotion set billed_settlement_id = sid where id = p.id;
  end loop;
  return sid;
end $$;

-- 정산서 무효화 시 광고 청구 해제
create or replace function app.settlement_void_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update public.vendor_promotion set billed_settlement_id = null where billed_settlement_id = new.id;
  end if;
  return new;
end $$;
create trigger settlement_void_release after update on public.platform_settlement for each row execute function app.settlement_void_release();

-- -----------------------------------------------------------------------------
-- 10. RPC — 업체 (채택된 견적을 자기 사업체의 계약으로)
-- -----------------------------------------------------------------------------
create or replace function public.convert_quote_to_contract(p_quote uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare q public.quote%rowtype; r record; bid uuid; v_customer uuid; v_site uuid; v_contract uuid; v_lines jsonb;
begin
  select * into q from public.quote where id = p_quote;
  if q.id is null then raise exception 'quote not found' using errcode = 'P0002'; end if;
  if q.status <> 'accepted' then raise exception '고객이 선택한 견적만 계약으로 만들 수 있습니다' using errcode = '42501'; end if;
  if q.contract_id is not null then return q.contract_id; end if;
  select * into r from public.market_request where id = q.request_id;
  if r.id is null then raise exception 'request not visible' using errcode = '42501'; end if;
  select m.branch_id into bid from public.membership m where m.tenant_id = q.tenant_id and m.profile_id = auth.uid() and m.status = 'active';
  insert into public.customer (tenant_id, branch_id, name, phone, address, source_code, memo, owner_id, created_by)
  values (q.tenant_id, bid, coalesce(r.contact_name, r.name_masked), r.contact_phone, r.contact_address, 'platform',
          '집대리 플랫폼 요청 · ' || r.region || coalesce(' ' || r.apt, ''), auth.uid(), auth.uid())
  returning id into v_customer;
  insert into public.site (tenant_id, customer_id, name, address, unit_type, move_in_date)
  values (q.tenant_id, v_customer, coalesce(r.apt, r.region), r.contact_address, case when r.area_pyeong is not null then r.area_pyeong || '평' end, r.move_in_date)
  returning id into v_site;
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(i->>'name', '품목'), 'qty', coalesce((i->>'qty')::numeric, 1), 'unit_price', coalesce((i->>'unit_price')::numeric, 0))), '[]'::jsonb)
    into v_lines from jsonb_array_elements(q.items) i;
  if jsonb_array_length(v_lines) = 0 then
    v_lines := jsonb_build_array(jsonb_build_object('name', '집대리 견적', 'qty', 1, 'unit_price', q.amount));
  end if;
  v_contract := public.create_contract(jsonb_build_object(
    'tenant_id', q.tenant_id, 'branch_id', bid, 'customer_id', v_customer, 'site_id', v_site,
    'intake_type_code', 'platform', 'sales_owner_id', auth.uid(), 'memo', q.message, 'lines', v_lines));
  update public.contract set platform_quote_id = q.id, source_code = 'platform' where id = v_contract;
  update public.quote set contract_id = v_contract where id = q.id;
  return v_contract;
end $$;

-- -----------------------------------------------------------------------------
-- 11. RPC — 고객·신청자 (로그인 없음, 서비스 키로만 호출)
-- -----------------------------------------------------------------------------
create or replace function public.vendor_apply(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  if coalesce(p->>'name', '') = '' or coalesce(p->>'phone', '') = '' or coalesce(p->>'email', '') = '' then
    raise exception '상호·전화·이메일은 필수입니다' using errcode = '22023';
  end if;
  insert into public.vendor_application (name, business_no, ceo_name, phone, email, address, regions, categories, intro, website, slug_wanted)
  values (p->>'name', p->>'business_no', p->>'ceo_name', app.norm_phone(p->>'phone'), p->>'email', p->>'address',
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'regions', '[]'::jsonb)) x), '{}'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'categories', '[]'::jsonb)) x), '{}'),
          p->>'intro', p->>'website', p->>'slug_wanted')
  returning id into aid;
  return aid;
end $$;

create or replace function public.request_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid; tok text; directed uuid;
begin
  if coalesce(p->>'name', '') = '' or coalesce(p->>'phone', '') = '' or coalesce(p->>'region', '') = '' then
    raise exception '이름·전화·지역은 필수입니다' using errcode = '22023';
  end if;
  if p->>'vendor_slug' is not null then
    select vc.tenant_id into directed from public.vendor_card vc where vc.slug = p->>'vendor_slug';
  end if;
  insert into public.service_request (name, phone, email, region, apt, address, area_pyeong, move_in_date, categories, message, budget, directed_tenant_id, external_id, utm)
  values (p->>'name', p->>'phone', p->>'email', p->>'region', p->>'apt', p->>'address', (p->>'area_pyeong')::int, (p->>'move_in_date')::date,
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'categories', '[]'::jsonb)) x), '{}'),
          p->>'message', (p->>'budget')::numeric, directed, nullif(p->>'external_id', ''), coalesce(p->'utm', '{}'::jsonb))
  returning id, token into rid, tok;
  return jsonb_build_object('id', rid, 'token', tok);
end $$;

-- 외부 회원(집대리 소비자 앱 등)의 요청 목록: 앱 서버가 서비스 키로 부른다. 토큰을 돌려주므로 앱이 /r/<token> 을 열 수 있다
create or replace function public.requests_by_external(p_external text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'token', r.token, 'status', r.status, 'region', r.region, 'apt', r.apt, 'categories', to_jsonb(r.categories),
           'created_at', r.created_at, 'expires_at', r.expires_at, 'accepted_quote_id', r.accepted_quote_id,
           'quote_count', (select count(*) from public.quote q where q.request_id = r.id and q.status <> 'withdrawn'),
           'unread_count', (select count(*) from public.request_message m where m.request_id = r.id and m.sender = 'vendor' and m.read_at is null))
         order by r.created_at desc), '[]'::jsonb)
  from public.service_request r
  where p_external is not null and p_external <> '' and r.external_id = p_external
$$;

create or replace function app.request_by_token(p_token text) returns public.service_request
language sql stable security definer set search_path = public as $$
  select * from public.service_request where token = p_token and length(p_token) >= 16
$$;

-- 고객 페이지 자료: 요청 + 견적(업체 카드 포함) + 업체별 대화
create or replace function public.request_page(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.service_request;
begin
  r := app.request_by_token(p_token);
  if r.id is null then return null; end if;
  return jsonb_build_object(
    'request', jsonb_build_object('id', r.id, 'name', r.name, 'phone_tail', right(r.phone, 4), 'region', r.region, 'apt', r.apt, 'address', r.address,
      'area_pyeong', r.area_pyeong, 'move_in_date', r.move_in_date, 'categories', to_jsonb(r.categories), 'message', r.message, 'budget', r.budget,
      'status', r.status, 'accepted_quote_id', r.accepted_quote_id, 'phone_shared', r.phone_shared, 'expires_at', r.expires_at, 'created_at', r.created_at,
      'directed_tenant_id', r.directed_tenant_id),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', q.id, 'tenant_id', q.tenant_id, 'amount', q.amount, 'items', q.items, 'message', q.message, 'available_from', q.available_from,
                 'valid_until', q.valid_until, 'status', q.status, 'created_at', q.created_at,
                 'vendor', jsonb_build_object('slug', vc.slug, 'name', vc.name, 'brand', vc.brand, 'rating', vc.rating, 'review_count', vc.review_count,
                                              'done_jobs', vc.done_jobs, 'featured', vc.featured, 'highlights', to_jsonb(vc.highlights), 'response_note', vc.response_note))
                 order by (q.status = 'accepted') desc, q.created_at), '[]'::jsonb)
               from public.quote q left join public.vendor_card vc on vc.tenant_id = q.tenant_id where q.request_id = r.id),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'tenant_id', m.tenant_id, 'sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
                 from public.request_message m where m.request_id = r.id),
    'categories', (select coalesce(jsonb_object_agg(code, label), '{}'::jsonb) from public.platform_category)
  );
end $$;

create or replace function public.request_accept(p_token text, p_quote uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.service_request; q public.quote%rowtype;
begin
  r := app.request_by_token(p_token);
  if r.id is null then raise exception 'unknown request' using errcode = '42501'; end if;
  if r.status <> 'open' then raise exception '이미 선택했거나 마감된 요청입니다' using errcode = '42501'; end if;
  select * into q from public.quote where id = p_quote and request_id = r.id;
  if q.id is null or q.status <> 'submitted' then raise exception '선택할 수 없는 견적입니다' using errcode = '42501'; end if;
  update public.quote set status = 'accepted' where id = q.id;
  update public.quote set status = 'declined' where request_id = r.id and id <> q.id and status = 'submitted';
  update public.service_request set status = 'accepted', accepted_quote_id = q.id where id = r.id;
  perform app.notify_members(q.tenant_id, 'market.write', 'quote.accepted', '견적이 선택되었습니다 · ' || r.region || coalesce(' ' || r.apt, ''),
    to_char(q.amount, 'FM999,999,999') || '원', '/market/requests/' || r.id);
end $$;

create or replace function public.request_customer_message(p_token text, p_tenant uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.service_request; mid uuid;
begin
  r := app.request_by_token(p_token);
  if r.id is null then raise exception 'unknown request' using errcode = '42501'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'empty message' using errcode = '22023'; end if;
  if not (r.directed_tenant_id is not distinct from p_tenant or exists (select 1 from public.quote q where q.request_id = r.id and q.tenant_id = p_tenant)) then
    raise exception '견적을 낸 업체에게만 메시지를 보낼 수 있습니다' using errcode = '42501';
  end if;
  insert into public.request_message (request_id, tenant_id, sender, body) values (r.id, p_tenant, 'customer', left(p_body, 2000)) returning id into mid;
  return mid;
end $$;

create or replace function public.request_share_phone(p_token text, p_share boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.service_request;
begin
  r := app.request_by_token(p_token);
  if r.id is null then raise exception 'unknown request' using errcode = '42501'; end if;
  update public.service_request set phone_shared = coalesce(p_share, false) where id = r.id;
end $$;

create or replace function public.request_close(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.service_request;
begin
  r := app.request_by_token(p_token);
  if r.id is null then raise exception 'unknown request' using errcode = '42501'; end if;
  if r.status in ('open','accepted') then
    update public.service_request set status = case when r.status = 'open' then 'canceled' else 'closed' end where id = r.id;
    update public.quote set status = 'declined' where request_id = r.id and status = 'submitted';
  end if;
end $$;

revoke execute on function public.vendor_apply(jsonb) from public, anon, authenticated;
revoke execute on function public.request_create(jsonb) from public, anon, authenticated;
revoke execute on function public.request_page(text) from public, anon, authenticated;
revoke execute on function public.request_accept(text, uuid) from public, anon, authenticated;
revoke execute on function public.request_customer_message(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.request_share_phone(text, boolean) from public, anon, authenticated;
revoke execute on function public.request_close(text) from public, anon, authenticated;
revoke execute on function public.requests_by_external(text) from public, anon, authenticated;
grant execute on function public.vendor_apply(jsonb) to service_role;
grant execute on function public.request_create(jsonb) to service_role;
grant execute on function public.request_page(text) to service_role;
grant execute on function public.request_accept(text, uuid) to service_role;
grant execute on function public.request_customer_message(text, uuid, text) to service_role;
grant execute on function public.request_share_phone(text, boolean) to service_role;
grant execute on function public.request_close(text) to service_role;
grant execute on function public.requests_by_external(text) to service_role;
grant execute on function public.claim_platform_operator(uuid) to authenticated;
grant execute on function public.approve_vendor(uuid, text) to authenticated;
grant execute on function public.build_platform_settlement(uuid, date, date) to authenticated;
grant execute on function public.convert_quote_to_contract(uuid) to authenticated;
grant select on public.vendor_card to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 12. RLS
-- -----------------------------------------------------------------------------
alter table public.platform                 enable row level security;
alter table public.platform_category        enable row level security;
alter table public.vendor_application       enable row level security;
alter table public.vendor_profile           enable row level security;
alter table public.platform_fee             enable row level security;
alter table public.service_request          enable row level security;
alter table public.quote                    enable row level security;
alter table public.request_message          enable row level security;
alter table public.vendor_promotion         enable row level security;
alter table public.platform_settlement      enable row level security;
alter table public.platform_settlement_line enable row level security;

create policy platform_select on public.platform for select to authenticated using (true);
create policy platform_update on public.platform for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy platform_category_select on public.platform_category for select to authenticated using (true);
create policy platform_category_write on public.platform_category for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

create policy vendor_application_admin on public.vendor_application for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- 업체 소개: 노출 중이면 누구나(로그인) 본다, 자기 사업체·운영자는 항상. 편집은 market.write / 운영자
create policy vendor_profile_select on public.vendor_profile for select to authenticated
  using (is_listed or app.is_member(tenant_id) or app.is_platform_admin());
create policy vendor_profile_insert on public.vendor_profile for insert to authenticated
  with check (app.has_perm(tenant_id, 'market.write') or app.is_platform_admin());
create policy vendor_profile_update on public.vendor_profile for update to authenticated
  using (app.has_perm(tenant_id, 'market.write') or app.is_platform_admin())
  with check (app.has_perm(tenant_id, 'market.write') or app.is_platform_admin());

create policy platform_fee_select on public.platform_fee for select to authenticated
  using (app.has_perm(tenant_id, 'market.settle') or app.is_platform_admin());
create policy platform_fee_write on public.platform_fee for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- 요청 원본(전화번호 포함)은 운영자만. 업체는 market_request 뷰로 본다
create policy service_request_admin on public.service_request for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

create policy quote_select on public.quote for select to authenticated
  using (app.has_perm(tenant_id, 'market.read') or app.is_platform_admin());
create policy quote_insert on public.quote for insert to authenticated
  with check (app.has_perm(tenant_id, 'market.write') and app.request_visible(request_id, tenant_id));
create policy quote_update on public.quote for update to authenticated
  using (app.has_perm(tenant_id, 'market.write') or app.is_platform_admin())
  with check (app.has_perm(tenant_id, 'market.write') or app.is_platform_admin());

create policy request_message_select on public.request_message for select to authenticated
  using (app.is_platform_admin() or (app.has_perm(tenant_id, 'market.read') and app.request_visible(request_id, tenant_id)));
create policy request_message_insert on public.request_message for insert to authenticated
  with check ((sender = 'vendor' and sender_id = auth.uid() and app.has_perm(tenant_id, 'market.write') and app.request_visible(request_id, tenant_id))
           or (sender = 'platform' and sender_id = auth.uid() and app.is_platform_admin()));
create policy request_message_update on public.request_message for update to authenticated
  using (app.has_perm(tenant_id, 'market.read') and app.request_visible(request_id, tenant_id))
  with check (app.has_perm(tenant_id, 'market.read') and app.request_visible(request_id, tenant_id));   -- 읽음 표시

create policy vendor_promotion_select on public.vendor_promotion for select to authenticated
  using (app.has_perm(tenant_id, 'market.read') or app.is_platform_admin());
create policy vendor_promotion_insert on public.vendor_promotion for insert to authenticated
  with check (app.has_perm(tenant_id, 'market.write') or app.is_platform_admin());
create policy vendor_promotion_update on public.vendor_promotion for update to authenticated
  using (app.has_perm(tenant_id, 'market.write') or app.is_platform_admin())
  with check (app.has_perm(tenant_id, 'market.write') or app.is_platform_admin());

create policy platform_settlement_select on public.platform_settlement for select to authenticated
  using (app.has_perm(tenant_id, 'market.settle') or app.is_platform_admin());
create policy platform_settlement_write on public.platform_settlement for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy platform_settlement_line_select on public.platform_settlement_line for select to authenticated
  using (app.has_perm(tenant_id, 'market.settle') or app.is_platform_admin());
create policy platform_settlement_line_write on public.platform_settlement_line for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
