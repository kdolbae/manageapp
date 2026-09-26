-- =============================================================================
-- 온라인 성과: 홈페이지 전환(전화·카톡·견적폼 누름) → 사람이 붙이는 결과(계약 성사·유효 상담·효과 없음)
--              → 계약 금액·광고비를 채널별로 맞대어 "온라인이 돈값을 하는지" 본다.
--
-- 전환 이벤트 자체는 여기 없다. 사업체 홈페이지가 쌓는 이벤트 로그(나노마스터: 홈페이지 Supabase 의 site_events)를
-- 서버가 읽어 온다(src/lib/online/events.ts, 연결은 배포 환경 변수 ONLINE_SOURCES). 여기엔 결과·직접 기록만 둔다.
--
--   conversion_label    결과 단계 이름. key 셋(won/valid/none)은 고정, 사업체가 이름·설명만 바꾼다. 없으면 기본 이름.
--   conversion_outcome  전환 한 건(source + event_id)에 결과 하나. 안 붙인 건은 줄이 없다(= 미확인).
--                       누른 시각·종류·채널을 붙일 때 같이 적어 두어, 영업 분석 요약은 홈페이지 기록 없이도 계산된다.
--                       계약 성사면 금액(공급가, 원)과 이 시스템의 계약(contract_id)을 붙일 수 있다. 계약 하나는 전환 하나에만.
--   ad_spend_ledger     날짜·채널 단위 직접 기록. kind = revenue(매출, 공급가) | spend(광고비, 부가세 별도).
--                       자동으로 못 읽는 광고비와, 전환에 못 맞춘 매출만 적는다. 지우기는 deleted_at.
--
-- 개인정보: 이름·전화번호를 적지 않는다. 메모에 전화번호 모양이 있으면 DB 가 거부한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 권한: 조회·기록은 대표·지점장·사무, 단계 이름은 대표만. 조회 역할은 조회만.
-- -----------------------------------------------------------------------------
insert into public.permission_catalog (code, module, label, sort_order) values
  ('conversion.read',   '분석', '온라인 성과(전환 결과·광고비 대비 매출) 조회', 132),
  ('conversion.write',  '분석', '전환 결과 붙이기·광고비·매출 직접 기록',       133),
  ('conversion.labels', '분석', '전환 결과 단계 이름 바꾸기',                   134)
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000001'::uuid, unnest(array['conversion.read','conversion.write','conversion.labels'])
union all
  select '10000000-0000-4000-8000-000000000002'::uuid, unnest(array['conversion.read','conversion.write'])
union all
  select '10000000-0000-4000-8000-000000000003'::uuid, unnest(array['conversion.read','conversion.write'])
union all
  select '10000000-0000-4000-8000-000000000007'::uuid, unnest(array['conversion.read'])
on conflict do nothing;

-- 채널 키. src/lib/online/channels.ts 와 같아야 한다.
create or replace function app.is_online_channel(c text) returns boolean
language sql immutable as $$ select c in ('inNaverAd','inMeta','inNaver','inGoogle','inDirect','inOther') $$;

-- 전화번호 모양(010-1234-5678, 01012345678, 02-123-4567, 031.123.4567 …). 금액(3500000)은 걸리지 않게 0 으로 시작하는 것만.
create or replace function app.has_phone_like(t text) returns boolean
language sql immutable as $$ select coalesce(t ~ '(^|[^0-9])0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}([^0-9]|$)', false) $$;

-- -----------------------------------------------------------------------------
-- 2. 결과 단계 이름
-- -----------------------------------------------------------------------------
create table public.conversion_label (
  tenant_id    uuid not null references public.tenant(id),
  key          text not null check (key in ('won','valid','none')),
  name         text not null check (length(name) between 1 and 20),
  description  text check (description is null or length(description) <= 120),
  sort         int not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, key)
);
comment on table public.conversion_label is '전환 결과 단계 이름(사업체별). key 셋 고정, 이름만 바꾼다. 행이 없으면 화면이 기본 이름(계약 성사/유효 상담/효과 없음)을 쓴다.';
create trigger conversion_label_touch before update on public.conversion_label for each row execute function app.touch();

-- -----------------------------------------------------------------------------
-- 3. 전환 결과
-- -----------------------------------------------------------------------------
create table public.conversion_outcome (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id),
  source       text not null default 'site' check (source ~ '^[a-z_]{1,20}$'),   -- 이벤트 출처(홈페이지 site_events = 'site')
  event_id     text not null check (length(event_id) between 1 and 64),        -- 출처 쪽 이벤트 id
  event_at     timestamptz not null,                                            -- 누른 시각(UTC)
  event_type   text not null check (event_type in ('call','kakao','form')),
  channel      text not null check (app.is_online_channel(channel)),
  outcome      text not null check (outcome in ('won','valid','none')),
  amount       bigint check (amount is null or (amount >= 0 and amount <= 10000000000)),   -- 계약 금액(공급가, 원)
  contract_id  uuid references public.contract(id),
  note         text check (note is null or (length(note) <= 300 and not app.has_phone_like(note))),
  set_by       uuid references public.profile(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, source, event_id),
  check (outcome = 'won' or (amount is null and contract_id is null))
);
comment on table public.conversion_outcome is '홈페이지 전환 한 건의 실제 결과. 계약 성사면 금액(공급가)·계약을 붙인다. 이름·전화번호 금지.';
create index conversion_outcome_period_idx on public.conversion_outcome (tenant_id, event_at);
-- 같은 계약을 두 전환에 붙이면 매출이 두 번 잡힌다
create unique index conversion_outcome_contract_uq on public.conversion_outcome (tenant_id, contract_id) where contract_id is not null;

create or replace function app.conversion_outcome_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.set_by := auth.uid(); end if;
  -- 계약이 아니면 금액·계약 연결을 지운다 — 유효 상담·효과 없음에 금액이 남아 매출로 잡히면 안 된다
  if new.outcome <> 'won' then new.amount := null; new.contract_id := null; end if;
  if new.contract_id is not null and not exists (
    select 1 from public.contract c where c.id = new.contract_id and c.tenant_id = new.tenant_id and c.deleted_at is null) then
    raise exception '같은 사업체의 계약만 붙일 수 있습니다.' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    -- 어느 전환인지·언제 눌렀는지는 바꾸지 않는다
    new.tenant_id := old.tenant_id; new.source := old.source; new.event_id := old.event_id;
    new.event_at := old.event_at; new.event_type := old.event_type; new.channel := old.channel; new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger conversion_outcome_before_write before insert or update on public.conversion_outcome for each row execute function app.conversion_outcome_before_write();
create trigger conversion_outcome_touch before update on public.conversion_outcome for each row execute function app.touch();
create trigger conversion_outcome_audit after insert or update or delete on public.conversion_outcome for each row execute function app.audit();

-- -----------------------------------------------------------------------------
-- 4. 광고비·매출 직접 기록
-- -----------------------------------------------------------------------------
create table public.ad_spend_ledger (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  kind        text not null check (kind in ('revenue','spend')),
  day         date not null,                                    -- 한국 날짜
  channel     text not null check (app.is_online_channel(channel)),
  amount      bigint not null check (amount >= 0 and amount <= 10000000000),
  note        text check (note is null or (length(note) <= 200 and not app.has_phone_like(note))),
  created_by  uuid references public.profile(id),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profile(id)
);
comment on table public.ad_spend_ledger is '광고비(부가세 별도)·매출(공급가) 직접 기록. 자동 광고비·전환 계약 금액과 겹치게 적지 않는다. 지우기는 deleted_at.';
create index ad_spend_ledger_period_idx on public.ad_spend_ledger (tenant_id, day) where deleted_at is null;

create or replace function app.ad_spend_ledger_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.deleted_at := null; new.deleted_by := null;
    return new;
  end if;
  -- 고치지 않는다: 지우기(deleted_at)만. 잘못 적었으면 지우고 새로 적는다.
  if (new.tenant_id, new.kind, new.day, new.channel, new.amount, new.note, new.created_by, new.created_at)
     is distinct from (old.tenant_id, old.kind, old.day, old.channel, old.amount, old.note, old.created_by, old.created_at) then
    raise exception '직접 기록은 고칠 수 없습니다. 지우고 새로 적어 주세요.' using errcode = '42501';
  end if;
  if old.deleted_at is not null then raise exception '이미 지운 기록입니다.' using errcode = '42501'; end if;
  new.deleted_at := coalesce(new.deleted_at, now());
  new.deleted_by := coalesce(auth.uid(), new.deleted_by);
  return new;
end $$;
create trigger ad_spend_ledger_before_write before insert or update on public.ad_spend_ledger for each row execute function app.ad_spend_ledger_before_write();
create trigger ad_spend_ledger_audit after insert or update or delete on public.ad_spend_ledger for each row execute function app.audit();

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
alter table public.conversion_label   enable row level security;
alter table public.conversion_outcome enable row level security;
alter table public.ad_spend_ledger    enable row level security;

create policy conversion_label_select on public.conversion_label for select to authenticated
  using (app.has_perm(tenant_id, 'conversion.read'));
create policy conversion_label_write on public.conversion_label for all to authenticated
  using (app.has_perm(tenant_id, 'conversion.labels')) with check (app.has_perm(tenant_id, 'conversion.labels'));

create policy conversion_outcome_select on public.conversion_outcome for select to authenticated
  using (app.has_perm(tenant_id, 'conversion.read'));
create policy conversion_outcome_insert on public.conversion_outcome for insert to authenticated
  with check (app.has_perm(tenant_id, 'conversion.write'));
create policy conversion_outcome_update on public.conversion_outcome for update to authenticated
  using (app.has_perm(tenant_id, 'conversion.write')) with check (app.has_perm(tenant_id, 'conversion.write'));
-- 결과를 지우면(미확인으로 되돌리면) 줄을 지운다. 감사 로그에 남는다.
create policy conversion_outcome_delete on public.conversion_outcome for delete to authenticated
  using (app.has_perm(tenant_id, 'conversion.write'));

create policy ad_spend_ledger_select on public.ad_spend_ledger for select to authenticated
  using (app.has_perm(tenant_id, 'conversion.read'));
create policy ad_spend_ledger_insert on public.ad_spend_ledger for insert to authenticated
  with check (app.has_perm(tenant_id, 'conversion.write'));
create policy ad_spend_ledger_update on public.ad_spend_ledger for update to authenticated
  using (app.has_perm(tenant_id, 'conversion.write')) with check (app.has_perm(tenant_id, 'conversion.write'));

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
