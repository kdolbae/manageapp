-- =============================================================================
-- D2: 사람(고객·현장·시공자·협력업체) + 상품(카테고리·상품·옵션·패키지·가격 규칙·기사 단가)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 공통 헬퍼
-- -----------------------------------------------------------------------------
create or replace function app.norm_phone(p text) returns text
language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$$;

-- 협력업체 계정: 구성원이 어느 협력업체 소속인지
alter table public.membership add column if not exists partner_id uuid;

create or replace function app.my_partner_id(tid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.partner_id from public.membership m
  where m.tenant_id = tid and m.profile_id = auth.uid() and m.status = 'active'
$$;

-- -----------------------------------------------------------------------------
-- 1. 고객 / 아파트 단지 / 현장
-- -----------------------------------------------------------------------------
create table public.customer (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id),
  branch_id          uuid references public.branch(id),
  name               text not null,
  phone              text,                       -- 숫자만 (app.norm_phone)
  phone2             text,
  email              citext,
  address            text,
  memo               text,
  source_code        text,                       -- code_value(customer_source)
  referrer_partner_id uuid,                      -- 소개처(협력업체) — FK 는 partner 생성 뒤 추가
  marketing_consent  boolean not null default false,
  consent_at         timestamptz,
  tags               text[] not null default '{}',
  owner_id           uuid references public.profile(id),   -- 담당자(영업자)
  created_by         uuid references public.profile(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index customer_tenant_phone_idx on public.customer (tenant_id, phone) where deleted_at is null;
create index customer_tenant_name_idx on public.customer (tenant_id, name) where deleted_at is null;

create table public.complex (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  name          text not null,                  -- 단지명 (예: 래미안 원베일리)
  address       text,
  region        text,                           -- 시·구 (필터용)
  builder       text,
  units         int,
  move_in_from  date,
  move_in_to    date,
  memo          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index complex_tenant_name_idx on public.complex (tenant_id, name) where deleted_at is null;

create table public.site (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  customer_id   uuid not null references public.customer(id),
  complex_id    uuid references public.complex(id),
  name          text not null,                  -- 표시명 (단지명 또는 주소)
  address       text,
  dong          text,
  ho            text,
  unit_type     text,                           -- 평형/타입
  move_in_date  date,
  memo          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index site_customer_idx on public.site (customer_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- 2. 시공자
-- -----------------------------------------------------------------------------
create table public.technician (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id),
  branch_id       uuid references public.branch(id),
  profile_id      uuid references public.profile(id),  -- 앱 계정(있으면)
  name            text not null,
  phone           text,
  skills          text[] not null default '{}',        -- code_value(work_area) 코드들
  vehicle_no      text,
  rate_type       text not null default 'rate_3_3' check (rate_type in ('rate_3_3','daily','invoice')),
  bank_name       text,
  bank_account    text,
  bank_holder     text,
  hire_date       date,
  memo            text,
  status          text not null default 'active' check (status in ('active','inactive')),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index technician_tenant_idx on public.technician (tenant_id, status) where deleted_at is null;
create unique index technician_profile_uq on public.technician (tenant_id, profile_id) where profile_id is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- 3. 협력업체
-- -----------------------------------------------------------------------------
create table public.partner (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  branch_id        uuid references public.branch(id),
  name             text not null,
  types            text[] not null default '{}',   -- code_value(partner_type): orderer 발주처, subcontract 외주, supplier 공급사, organizer 주관사, referrer 소개처
  business_no      text,
  ceo_name         text,
  phone            text,
  email            citext,
  address          text,
  contact_name     text,
  contact_phone    text,
  commission_rate  numeric(6,3),                   -- 소개·발주 수수료율(%)
  settlement_terms text,                           -- 정산 조건 메모
  memo             text,
  status           text not null default 'active' check (status in ('active','inactive')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index partner_tenant_idx on public.partner (tenant_id, status) where deleted_at is null;
alter table public.customer add constraint customer_referrer_fk foreign key (referrer_partner_id) references public.partner(id);
alter table public.membership add constraint membership_partner_fk foreign key (partner_id) references public.partner(id);

-- -----------------------------------------------------------------------------
-- 4. 상품
-- -----------------------------------------------------------------------------
create table public.product_category (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  parent_id   uuid references public.product_category(id),
  code        text not null,
  name        text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (tenant_id, code)
);

create table public.product (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  category_id      uuid references public.product_category(id),
  code             text not null,
  name             text not null,
  kind             text not null default 'single' check (kind in ('single','package','service')),
  work_area_code   text,                          -- code_value(work_area): 이 상품이 만드는 시공 건의 작업 단위
  unit             text not null default '식',
  price            numeric(14,0) not null default 0,   -- 판매가(부가세 포함)
  technician_rate  numeric(14,0) not null default 0,   -- 기본 기사 시공비
  duration_min     int,                            -- 시공 소요(분)
  description      text,
  status           text not null default 'active' check (status in ('active','inactive')),
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (tenant_id, code)
);
create index product_tenant_idx on public.product (tenant_id, status) where deleted_at is null;

create table public.option_group (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  product_id  uuid not null references public.product(id) on delete cascade,
  name        text not null,
  required    boolean not null default false,
  multi       boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index option_group_product_idx on public.option_group (product_id);

create table public.product_option (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenant(id),
  group_id               uuid not null references public.option_group(id) on delete cascade,
  name                   text not null,
  price_delta            numeric(14,0) not null default 0,
  technician_rate_delta  numeric(14,0) not null default 0,
  is_default             boolean not null default false,
  sort_order             int not null default 0,
  created_at             timestamptz not null default now()
);
create index product_option_group_idx on public.product_option (group_id);

create table public.package_item (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  package_id    uuid not null references public.product(id) on delete cascade,
  product_id    uuid not null references public.product(id),
  qty           numeric(10,2) not null default 1,
  price_override numeric(14,0),
  sort_order    int not null default 0,
  unique (package_id, product_id)
);

-- 가격 규칙: 지점·협력업체·단지·기간별로 판매가/기사비를 덮어쓴다. priority 큰 것이 이긴다.
create table public.price_rule (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  product_id       uuid not null references public.product(id) on delete cascade,
  branch_id        uuid references public.branch(id),
  partner_id       uuid references public.partner(id),
  complex_id       uuid references public.complex(id),
  price            numeric(14,0),
  technician_rate  numeric(14,0),
  valid_from       date,
  valid_to         date,
  priority         int not null default 0,
  memo             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index price_rule_product_idx on public.price_rule (product_id);

-- 기사별 단가(기본 기사비를 기사 개인별로 덮어쓸 때)
create table public.technician_rate (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id),
  technician_id  uuid not null references public.technician(id) on delete cascade,
  product_id     uuid not null references public.product(id) on delete cascade,
  rate           numeric(14,0) not null,
  valid_from     date,
  valid_to       date,
  created_at     timestamptz not null default now(),
  unique (technician_id, product_id, valid_from)
);

-- 유효 가격 계산: 규칙(기간·지점·협력업체·단지) 중 우선순위 높은 것, 없으면 상품 기본값
create or replace function public.effective_price(
  p_product uuid, p_branch uuid default null, p_partner uuid default null, p_complex uuid default null, p_date date default current_date)
returns table (price numeric, technician_rate numeric, rule_id uuid)
language sql stable security invoker set search_path = public as $$
  with r as (
    select pr.*
    from public.price_rule pr
    where pr.product_id = p_product
      and (pr.branch_id is null or pr.branch_id = p_branch)
      and (pr.partner_id is null or pr.partner_id = p_partner)
      and (pr.complex_id is null or pr.complex_id = p_complex)
      and (pr.valid_from is null or pr.valid_from <= p_date)
      and (pr.valid_to is null or pr.valid_to >= p_date)
    order by pr.priority desc,
      (pr.partner_id is not null)::int + (pr.complex_id is not null)::int + (pr.branch_id is not null)::int desc,
      pr.created_at desc
    limit 1)
  select coalesce(r.price, p.price), coalesce(r.technician_rate, p.technician_rate), r.id
  from public.product p left join r on true
  where p.id = p_product
$$;
grant execute on function public.effective_price(uuid, uuid, uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. 트리거 (updated_at, 감사, 전화번호 정규화)
-- -----------------------------------------------------------------------------
create or replace function app.norm_customer() returns trigger
language plpgsql as $$
begin
  new.phone := app.norm_phone(new.phone);
  new.phone2 := app.norm_phone(new.phone2);
  if new.marketing_consent and new.consent_at is null then new.consent_at := now(); end if;
  if not new.marketing_consent then new.consent_at := null; end if;
  return new;
end $$;
create trigger customer_norm before insert or update on public.customer for each row execute function app.norm_customer();

create or replace function app.norm_contact() returns trigger
language plpgsql as $$
declare j jsonb := to_jsonb(new);
begin
  if j ? 'phone' then new := jsonb_populate_record(new, jsonb_build_object('phone', app.norm_phone(j->>'phone'))); end if;
  if j ? 'contact_phone' then new := jsonb_populate_record(new, jsonb_build_object('contact_phone', app.norm_phone(j->>'contact_phone'))); end if;
  return new;
end $$;
create trigger technician_norm before insert or update on public.technician for each row execute function app.norm_contact();
create trigger partner_norm before insert or update on public.partner for each row execute function app.norm_contact();

do $$
declare t text;
begin
  foreach t in array array['customer','complex','site','technician','partner','product_category','product','price_rule']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['customer','complex','site','technician','partner','product_category','product','option_group','product_option','package_item','price_rule','technician_rate']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 6. RLS
-- -----------------------------------------------------------------------------
alter table public.customer         enable row level security;
alter table public.complex          enable row level security;
alter table public.site             enable row level security;
alter table public.technician       enable row level security;
alter table public.partner          enable row level security;
alter table public.product_category enable row level security;
alter table public.product          enable row level security;
alter table public.option_group     enable row level security;
alter table public.product_option   enable row level security;
alter table public.package_item     enable row level security;
alter table public.price_rule       enable row level security;
alter table public.technician_rate  enable row level security;

-- 고객: 범위 안(own = 담당자) + 협력업체 계정은 자기 소개 고객만
create policy customer_select on public.customer for select to authenticated
  using (app.has_perm(tenant_id, 'customer.read')
     and (app.in_scope(tenant_id, branch_id, owner_id)
          or (app.my_partner_id(tenant_id) is not null and referrer_partner_id = app.my_partner_id(tenant_id))));
create policy customer_insert on public.customer for insert to authenticated
  with check (app.has_perm(tenant_id, 'customer.write') and app.in_scope(tenant_id, branch_id, owner_id, true));
create policy customer_update on public.customer for update to authenticated
  using (app.has_perm(tenant_id, 'customer.write') and app.in_scope(tenant_id, branch_id, owner_id, true))
  with check (app.has_perm(tenant_id, 'customer.write') and app.in_scope(tenant_id, branch_id, owner_id, true));

create policy complex_select on public.complex for select to authenticated using (app.is_member(tenant_id));
create policy complex_write on public.complex for all to authenticated
  using (app.has_perm(tenant_id, 'customer.write')) with check (app.has_perm(tenant_id, 'customer.write'));

create policy site_select on public.site for select to authenticated
  using (exists (select 1 from public.customer c where c.id = customer_id));   -- 고객이 보이면 현장도 보인다
create policy site_write on public.site for all to authenticated
  using (app.has_perm(tenant_id, 'customer.write') and exists (select 1 from public.customer c where c.id = customer_id))
  with check (app.has_perm(tenant_id, 'customer.write') and exists (select 1 from public.customer c where c.id = customer_id));

-- 시공자: 조회 권한 + 범위(own = 본인 계정). 계좌는 화면에서 권한 따라 가린다.
create policy technician_select on public.technician for select to authenticated
  using (app.has_perm(tenant_id, 'technician.read') and app.in_scope(tenant_id, branch_id, profile_id));
create policy technician_write on public.technician for all to authenticated
  using (app.has_perm(tenant_id, 'technician.write') and app.in_scope(tenant_id, branch_id, profile_id, true))
  with check (app.has_perm(tenant_id, 'technician.write') and app.in_scope(tenant_id, branch_id, profile_id, true));

-- 협력업체: 조회 권한 + 범위, 협력업체 계정은 자기 회사만
create policy partner_select on public.partner for select to authenticated
  using (app.has_perm(tenant_id, 'partner.read')
     and (app.in_scope(tenant_id, branch_id, null) or id = app.my_partner_id(tenant_id)));
create policy partner_write on public.partner for all to authenticated
  using (app.has_perm(tenant_id, 'partner.write') and app.in_scope(tenant_id, branch_id, null, true))
  with check (app.has_perm(tenant_id, 'partner.write') and app.in_scope(tenant_id, branch_id, null, true));

-- 상품: 구성원 누구나 조회, 상품 관리 권한으로 수정
create policy product_category_select on public.product_category for select to authenticated using (app.is_member(tenant_id));
create policy product_category_write  on public.product_category for all to authenticated
  using (app.has_perm(tenant_id, 'product.manage')) with check (app.has_perm(tenant_id, 'product.manage'));
create policy product_select on public.product for select to authenticated using (app.is_member(tenant_id));
create policy product_write  on public.product for all to authenticated
  using (app.has_perm(tenant_id, 'product.manage')) with check (app.has_perm(tenant_id, 'product.manage'));
create policy option_group_select on public.option_group for select to authenticated using (app.is_member(tenant_id));
create policy option_group_write  on public.option_group for all to authenticated
  using (app.has_perm(tenant_id, 'product.manage')) with check (app.has_perm(tenant_id, 'product.manage'));
create policy product_option_select on public.product_option for select to authenticated using (app.is_member(tenant_id));
create policy product_option_write  on public.product_option for all to authenticated
  using (app.has_perm(tenant_id, 'product.manage')) with check (app.has_perm(tenant_id, 'product.manage'));
create policy package_item_select on public.package_item for select to authenticated using (app.is_member(tenant_id));
create policy package_item_write  on public.package_item for all to authenticated
  using (app.has_perm(tenant_id, 'product.manage')) with check (app.has_perm(tenant_id, 'product.manage'));
create policy price_rule_select on public.price_rule for select to authenticated
  using (app.is_member(tenant_id) and app.has_perm(tenant_id, 'contract.read'));
create policy price_rule_write  on public.price_rule for all to authenticated
  using (app.has_perm(tenant_id, 'product.manage')) with check (app.has_perm(tenant_id, 'product.manage'));
-- 기사 단가: 시공비 정보는 정산·상품 관리 권한자와 본인 기사만
create policy technician_rate_select on public.technician_rate for select to authenticated
  using (app.has_perm(tenant_id, 'payout.read') or app.has_perm(tenant_id, 'product.manage')
      or exists (select 1 from public.technician t where t.id = technician_id and t.profile_id = auth.uid()));
create policy technician_rate_write on public.technician_rate for all to authenticated
  using (app.has_perm(tenant_id, 'product.manage')) with check (app.has_perm(tenant_id, 'product.manage'));

-- -----------------------------------------------------------------------------
-- 7. 사업체 기본 코드값 시드 (작업 단위·접수 형태·결제수단·협력업체 유형·유입 경로)
-- -----------------------------------------------------------------------------
create or replace function app.seed_tenant_defaults(tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.code_value (tenant_id, domain, code, label, color, sort_order) values
    (tid, 'work_area', 'kitchen',  '주방', 'wa1', 1),
    (tid, 'work_area', 'bath',     '욕실', 'wa2', 2),
    (tid, 'intake_type', 'voice',      '음성계약', null, 1),
    (tid, 'intake_type', 'fair',       '박람회',   null, 2),
    (tid, 'intake_type', 'option',     '옵션',     null, 3),
    (tid, 'intake_type', 'pre',        '사전계약', null, 4),
    (tid, 'intake_type', 'free',       '무상시공', null, 5),
    (tid, 'intake_type', 'partner',    '협력업체', null, 6),
    (tid, 'intake_type', 'web',        '홈페이지', null, 7),
    (tid, 'intake_type', 'etc',        '기타',     null, 9),
    (tid, 'pay_method', 'card',     '카드',     null, 1),
    (tid, 'pay_method', 'transfer', '계좌이체', null, 2),
    (tid, 'pay_method', 'cash',     '현금',     null, 3),
    (tid, 'partner_type', 'orderer',     '발주처', null, 1),
    (tid, 'partner_type', 'subcontract', '외주',   null, 2),
    (tid, 'partner_type', 'supplier',    '공급사', null, 3),
    (tid, 'partner_type', 'organizer',   '주관사', null, 4),
    (tid, 'partner_type', 'referrer',    '소개처', null, 5),
    (tid, 'customer_source', 'web',      '홈페이지', null, 1),
    (tid, 'customer_source', 'fair',     '박람회',   null, 2),
    (tid, 'customer_source', 'referral', '지인 소개', null, 3),
    (tid, 'customer_source', 'partner',  '협력업체', null, 4),
    (tid, 'customer_source', 'ad',       '광고',     null, 5),
    (tid, 'customer_source', 'repeat',   '재구매',   null, 6),
    (tid, 'customer_source', 'etc',      '기타',     null, 9)
  on conflict (tenant_id, domain, code) do nothing;
end $$;

-- 기존 사업체에 적용 + 새 사업체 생성 시 자동 적용
do $$
declare t uuid;
begin
  for t in select id from public.tenant loop perform app.seed_tenant_defaults(t); end loop;
end $$;

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
  perform app.seed_tenant_defaults(tid);
  return tid;
end $$;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
