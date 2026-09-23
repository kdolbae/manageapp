-- =============================================================================
-- D7: 문의 인입함 + 상담 기록 + 알림(아웃박스·앱 내 알림) + 연동 설정
-- =============================================================================

create table public.inquiry (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id),
  branch_id          uuid references public.branch(id),
  channel            text not null default 'web' check (channel in ('web','phone','kakao','partner','walk_in','fair','other')),
  kind               text,                                  -- 문의 종류(견적·시공·AS 등, 홈페이지 폼 값 그대로)
  name               text,
  phone              text,
  email              citext,
  address            text,
  apt                text,                                  -- 단지명
  message            text,
  source_page        text,                                  -- 문의가 들어온 페이지
  utm                jsonb not null default '{}'::jsonb,    -- utm_source/medium/campaign/term/content, referrer
  extra              jsonb not null default '{}'::jsonb,
  attachments        jsonb not null default '[]'::jsonb,    -- [{name, url}]
  status             text not null default 'new' check (status in ('new','contacted','quoted','converted','closed','spam')),
  assigned_to        uuid references public.profile(id),
  customer_id        uuid references public.customer(id),
  contract_id        uuid references public.contract(id),
  external_id        text,                                  -- 외부 시스템 id (홈페이지 inquiries.id) — 중복 방지
  first_response_at  timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index inquiry_tenant_status_idx on public.inquiry (tenant_id, status, created_at desc) where deleted_at is null;
create unique index inquiry_external_uq on public.inquiry (tenant_id, channel, external_id) where external_id is not null;

create table public.consultation (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id),
  inquiry_id      uuid references public.inquiry(id),
  customer_id     uuid references public.customer(id),
  contract_id     uuid references public.contract(id),
  channel         text not null default 'call' check (channel in ('call','sms','kakao','visit','email','memo')),
  direction       text not null default 'out' check (direction in ('in','out')),
  summary         text not null,
  next_action     text,
  next_action_at  timestamptz,
  actor_id        uuid references public.profile(id),
  created_at      timestamptz not null default now()
);
create index consultation_inquiry_idx on public.consultation (inquiry_id, created_at desc);
create index consultation_customer_idx on public.consultation (customer_id, created_at desc);

-- 연동 설정 (Teams 웹훅 주소, 홈페이지 문의 API 키 해시 등). 값은 tenant.manage 만 읽는다.
create table public.integration_config (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  kind        text not null check (kind in ('teams_webhook','web_inquiry','kakao_solapi','anthropic','push_vapid')),
  config      jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, kind)
);

-- 발송 대기열: Teams·알림톡·문자·푸시·메일. 서버(서비스 키)만 처리한다.
create table public.notification_outbox (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  channel       text not null check (channel in ('teams','kakao','sms','push','email')),
  to_ref        text,                          -- 전화번호·프로필 id·웹훅 별칭
  template      text not null,                 -- 예: inquiry.new, job.assigned
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts      int not null default 0,
  last_error    text,
  scheduled_at  timestamptz not null default now(),
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index notification_outbox_pending_idx on public.notification_outbox (status, scheduled_at) where status = 'pending';

-- 앱 내 알림 (종 아이콘·실시간 토스트)
create table public.inapp_notification (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  profile_id  uuid not null references public.profile(id) on delete cascade,
  kind        text not null,                    -- inquiry.new, job.assigned, approval.requested ...
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index inapp_notification_profile_idx on public.inapp_notification (profile_id, created_at desc) where read_at is null;

-- 트리거: 전화번호 정규화·첫 응답 시각·상태 이력·감사
create or replace function app.inquiry_before_write() returns trigger
language plpgsql as $$
begin
  new.phone := app.norm_phone(new.phone);
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status = 'new' and new.first_response_at is null then new.first_response_at := now(); end if;
    if new.status in ('closed','spam','converted') and new.closed_at is null then new.closed_at := now(); end if;
  end if;
  return new;
end $$;
create trigger inquiry_before_write before insert or update on public.inquiry for each row execute function app.inquiry_before_write();

create or replace function app.inquiry_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.status_history (tenant_id, entity, entity_id, from_status, to_status, actor_id)
    values (new.tenant_id, 'inquiry', new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;
create trigger inquiry_after_write after update on public.inquiry for each row execute function app.inquiry_after_write();

-- 상담 기록이 남으면 문의 상태를 자동으로 '연락함' 으로
create or replace function app.consultation_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.actor_id is null then new.actor_id := auth.uid(); end if;
  if new.inquiry_id is not null then
    update public.inquiry set status = 'contacted' where id = new.inquiry_id and status = 'new';
  end if;
  return new;
end $$;
create trigger consultation_after_insert after insert on public.consultation for each row execute function app.consultation_after_insert();

do $$
declare t text;
begin
  foreach t in array array['inquiry','integration_config'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['inquiry','consultation','integration_config'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- 새 문의 → 문의 조회 권한이 있는 구성원 모두에게 앱 내 알림 + Teams 아웃박스
create or replace function app.inquiry_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare title text; body text;
begin
  title := coalesce(new.name, '이름 없음') || ' 님 문의' || case when new.kind is not null then ' · ' || new.kind else '' end;
  body := left(coalesce(new.message, ''), 120);
  insert into public.inapp_notification (tenant_id, profile_id, kind, title, body, link)
    select distinct new.tenant_id, m.profile_id, 'inquiry.new', title, body, '/inbox/' || new.id
    from public.membership m
    join public.role_permission rp on rp.role_id = m.role_id
    where m.tenant_id = new.tenant_id and m.status = 'active' and rp.permission = 'inquiry.read'
      and (m.scope in ('tenant','group') or (m.scope = 'branch' and (new.branch_id is null or m.branch_id = new.branch_id)));
  if exists (select 1 from public.integration_config ic where ic.tenant_id = new.tenant_id and ic.kind = 'teams_webhook' and ic.is_active) then
    insert into public.notification_outbox (tenant_id, channel, template, payload)
    values (new.tenant_id, 'teams', 'inquiry.new', jsonb_build_object('inquiry_id', new.id, 'title', title, 'body', body, 'phone', new.phone, 'apt', new.apt, 'channel', new.channel, 'source_page', new.source_page));
  end if;
  return new;
end $$;
create trigger inquiry_notify after insert on public.inquiry for each row execute function app.inquiry_notify();

-- Realtime (Supabase 에서만 존재하는 publication)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.inapp_notification';
    execute 'alter publication supabase_realtime add table public.inquiry';
  end if;
end $$;

-- RLS
alter table public.inquiry              enable row level security;
alter table public.consultation         enable row level security;
alter table public.integration_config   enable row level security;
alter table public.notification_outbox  enable row level security;
alter table public.inapp_notification   enable row level security;

create policy inquiry_select on public.inquiry for select to authenticated
  using (app.has_perm(tenant_id, 'inquiry.read') and app.in_scope(tenant_id, branch_id, assigned_to));
create policy inquiry_insert on public.inquiry for insert to authenticated
  with check (app.has_perm(tenant_id, 'inquiry.write') and app.in_scope(tenant_id, branch_id, assigned_to, true));
create policy inquiry_update on public.inquiry for update to authenticated
  using (app.has_perm(tenant_id, 'inquiry.write') and app.in_scope(tenant_id, branch_id, assigned_to, true))
  with check (app.has_perm(tenant_id, 'inquiry.write') and app.in_scope(tenant_id, branch_id, assigned_to, true));

create policy consultation_select on public.consultation for select to authenticated
  using (app.is_member(tenant_id) and (app.has_perm(tenant_id, 'inquiry.read') or app.has_perm(tenant_id, 'customer.read')));
create policy consultation_insert on public.consultation for insert to authenticated
  with check (app.has_perm(tenant_id, 'inquiry.write') or app.has_perm(tenant_id, 'customer.write'));

create policy integration_config_all on public.integration_config for all to authenticated
  using (app.has_perm(tenant_id, 'tenant.manage')) with check (app.has_perm(tenant_id, 'tenant.manage'));

create policy notification_outbox_select on public.notification_outbox for select to authenticated
  using (app.has_perm(tenant_id, 'tenant.manage'));

create policy inapp_notification_select on public.inapp_notification for select to authenticated using (profile_id = auth.uid());
create policy inapp_notification_update on public.inapp_notification for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- 홈페이지 문의 인입용 함수 (서비스 키로 호출): API 키 해시로 사업체를 찾아 문의를 넣는다
create or replace function public.ingest_web_inquiry(p_key_hash text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; iid uuid;
begin
  select ic.tenant_id into tid from public.integration_config ic
  where ic.kind = 'web_inquiry' and ic.is_active and ic.config ->> 'key_hash' = p_key_hash;
  if tid is null then
    raise exception 'unknown api key' using errcode = '42501';
  end if;
  insert into public.inquiry (tenant_id, channel, kind, name, phone, email, address, apt, message, source_page, utm, extra, attachments, external_id)
  values (tid, coalesce(p->>'channel', 'web'), p->>'kind', p->>'name', p->>'phone', p->>'email', p->>'address', p->>'apt', p->>'message',
          p->>'source_page', coalesce(p->'utm', '{}'::jsonb), coalesce(p->'extra', '{}'::jsonb), coalesce(p->'attachments', '[]'::jsonb), p->>'external_id')
  on conflict (tenant_id, channel, external_id) where external_id is not null do nothing
  returning id into iid;
  return iid;
end $$;
revoke execute on function public.ingest_web_inquiry(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_web_inquiry(text, jsonb) to service_role;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
