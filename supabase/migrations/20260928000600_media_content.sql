-- =============================================================================
-- D6/D7: 시공 사진(media_asset) · 후기(review) · 콘텐츠(content_post) · 푸시 구독
--  - 사진 원본은 Supabase Storage 버킷 'media' (비공개). 경로: <tenant_id>/<yyyymm>/<uuid>.<ext>
--  - 마케팅 사용은 고객 동의 + 발행 권한(content.publish)이 있어야 켤 수 있다
-- =============================================================================

create table public.media_asset (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id),
  branch_id      uuid references public.branch(id),
  job_id         uuid references public.job(id),
  contract_id    uuid references public.contract(id),
  customer_id    uuid references public.customer(id),
  kind           text not null default 'after' check (kind in ('before','after','process','issue','receipt','review','other')),
  work_area_code text,
  bucket         text not null default 'media',
  path           text not null,
  mime           text,
  bytes          int,
  width          int,
  height         int,
  taken_at       timestamptz,
  caption        text,
  marketing_ok   boolean not null default false,   -- 마케팅(콘텐츠) 사용 가능: 고객 동의 + 노출 검토 완료
  tags           text[] not null default '{}',
  uploaded_by    uuid references public.profile(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (bucket, path)
);
create index media_asset_job_idx on public.media_asset (job_id) where deleted_at is null;
create index media_asset_contract_idx on public.media_asset (contract_id) where deleted_at is null;
create index media_asset_tenant_idx on public.media_asset (tenant_id, created_at desc) where deleted_at is null;
create index media_asset_marketing_idx on public.media_asset (tenant_id) where marketing_ok and deleted_at is null;

create table public.review (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id),
  branch_id         uuid references public.branch(id),
  contract_id       uuid references public.contract(id),
  job_id            uuid references public.job(id),
  customer_id       uuid references public.customer(id),
  channel           text not null default 'manual' check (channel in ('app','kakao','naver','google','instagram','manual')),
  rating            smallint check (rating between 1 and 5),
  body              text,
  author_name       text,                                  -- 표시용 이름(예: 김○○)
  source_url        text,
  media_ids         uuid[] not null default '{}',
  consent_marketing boolean not null default false,        -- 후기·사진 마케팅 사용 동의
  consent_at        timestamptz,
  status            text not null default 'pending' check (status in ('pending','approved','hidden')),
  response          text,                                  -- 사업체 답글
  responded_at      timestamptz,
  token             text unique default encode(gen_random_bytes(16), 'hex'),  -- 고객 후기 작성 링크(D10)
  token_expires_at  timestamptz default now() + interval '30 days',
  created_by        uuid references public.profile(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index review_tenant_idx on public.review (tenant_id, created_at desc) where deleted_at is null;
create index review_contract_idx on public.review (contract_id) where deleted_at is null;

create table public.content_post (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  branch_id     uuid references public.branch(id),
  kind          text not null default 'instagram' check (kind in ('instagram','naver_blog','kakao_channel','youtube_short','blog','ad','other')),
  title         text,
  body          text,
  hashtags      text[] not null default '{}',
  media_ids     uuid[] not null default '{}',
  review_id     uuid references public.review(id),
  contract_id   uuid references public.contract(id),
  status        text not null default 'draft' check (status in ('draft','ready','published','archived')),
  published_at  timestamptz,
  published_url text,
  utm_campaign  text,                                      -- 이 콘텐츠 링크의 utm_campaign (유입 추적)
  ai_model      text,                                      -- 초안을 만든 모델(있으면)
  ai_prompt     text,
  created_by    uuid references public.profile(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index content_post_tenant_idx on public.content_post (tenant_id, status, created_at desc) where deleted_at is null;

-- 웹 푸시 구독 (브라우저/앱 설치 단위). VAPID 키는 서버 환경변수.
create table public.push_subscription (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profile(id) on delete cascade,
  endpoint    text not null unique,
  keys        jsonb not null,                     -- {p256dh, auth}
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_subscription_profile_idx on public.push_subscription (profile_id);

-- -----------------------------------------------------------------------------
-- 트리거: 사진의 계약·고객·지점 자동 채움, 마케팅 사용 켜기 권한, 발행 권한
-- -----------------------------------------------------------------------------
create or replace function app.media_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.job_id is not null and (new.contract_id is null or new.work_area_code is null) then
    select j.contract_id, j.work_area_code into c from public.job j where j.id = new.job_id;
    new.contract_id := coalesce(new.contract_id, c.contract_id);
    new.work_area_code := coalesce(new.work_area_code, c.work_area_code);
  end if;
  if new.contract_id is not null and (new.customer_id is null or new.branch_id is null) then
    select ct.customer_id, ct.branch_id into c from public.contract ct where ct.id = new.contract_id;
    new.customer_id := coalesce(new.customer_id, c.customer_id);
    new.branch_id := coalesce(new.branch_id, c.branch_id);
  end if;
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    if new.marketing_ok and not app.has_perm(new.tenant_id, 'content.publish') then
      raise exception '마케팅 사용은 발행 권한이 있어야 켤 수 있습니다' using errcode = '42501';
    end if;
  elsif new.marketing_ok and not old.marketing_ok and not app.has_perm(new.tenant_id, 'content.publish') then
    raise exception '마케팅 사용은 발행 권한이 있어야 켤 수 있습니다' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger media_before_write before insert or update on public.media_asset for each row execute function app.media_before_write();

create or replace function app.review_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.consent_marketing and new.consent_at is null then new.consent_at := now(); end if;
  else
    if new.consent_marketing and not old.consent_marketing then new.consent_at := coalesce(new.consent_at, now()); end if;
    if new.response is distinct from old.response and new.response is not null then new.responded_at := now(); end if;
    if new.status is distinct from old.status and new.status = 'approved' and not app.has_perm(new.tenant_id, 'content.publish') then
      raise exception '후기 승인은 발행 권한이 필요합니다' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger review_before_write before insert or update on public.review for each row execute function app.review_before_write();

create or replace function app.content_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    if not app.has_perm(new.tenant_id, 'content.publish') then
      raise exception '콘텐츠 발행은 발행 권한이 필요합니다' using errcode = '42501';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;
create trigger content_before_write before insert or update on public.content_post for each row execute function app.content_before_write();

do $$
declare t text;
begin
  foreach t in array array['media_asset','review','content_post'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS
--  사진: 조회 = content.read + 범위(지점/본인 업로드) 또는 내가 배정된 시공의 사진
--        쓰기 = content.write + 범위(엄격). 기사는 본인이 올린 것만 고친다.
-- -----------------------------------------------------------------------------
alter table public.media_asset       enable row level security;
alter table public.review            enable row level security;
alter table public.content_post      enable row level security;
alter table public.push_subscription enable row level security;

create policy media_select on public.media_asset for select to authenticated
  using (app.has_perm(tenant_id, 'content.read')
         and (app.in_scope(tenant_id, branch_id, uploaded_by)
              or (job_id is not null and app.job_owner(job_id) = auth.uid())
              or (contract_id is not null and app.is_assigned_technician(contract_id))));
create policy media_insert on public.media_asset for insert to authenticated
  with check (app.has_perm(tenant_id, 'content.write')
              and (app.in_scope(tenant_id, branch_id, uploaded_by, true)
                   or (job_id is not null and app.job_owner(job_id) = auth.uid()))
              -- 붙이는 시공 건·계약은 내가 볼 수 있는 것이어야 한다 (job/contract RLS 로 걸러짐)
              and (job_id is null or exists (select 1 from public.job j where j.id = job_id))
              and (contract_id is null or exists (select 1 from public.contract c where c.id = contract_id)));
create policy media_update on public.media_asset for update to authenticated
  using (app.has_perm(tenant_id, 'content.write') and app.in_scope(tenant_id, branch_id, uploaded_by, true))
  with check (app.has_perm(tenant_id, 'content.write') and app.in_scope(tenant_id, branch_id, uploaded_by, true));

create policy review_select on public.review for select to authenticated
  using (app.has_perm(tenant_id, 'content.read') and app.in_scope(tenant_id, branch_id, created_by));
create policy review_write on public.review for insert to authenticated
  with check (app.has_perm(tenant_id, 'content.write') and app.in_scope(tenant_id, branch_id, created_by, true));
create policy review_update on public.review for update to authenticated
  using (app.has_perm(tenant_id, 'content.write') and app.in_scope(tenant_id, branch_id, created_by, true))
  with check (app.has_perm(tenant_id, 'content.write') and app.in_scope(tenant_id, branch_id, created_by, true));

create policy content_select on public.content_post for select to authenticated
  using (app.has_perm(tenant_id, 'content.read') and app.in_scope(tenant_id, branch_id, created_by));
create policy content_insert on public.content_post for insert to authenticated
  with check (app.has_perm(tenant_id, 'content.write') and app.in_scope(tenant_id, branch_id, created_by, true));
create policy content_update on public.content_post for update to authenticated
  using (app.has_perm(tenant_id, 'content.write') and app.in_scope(tenant_id, branch_id, created_by, true))
  with check (app.has_perm(tenant_id, 'content.write') and app.in_scope(tenant_id, branch_id, created_by, true));

create policy push_subscription_own on public.push_subscription for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Storage 버킷 'media' (Supabase 에서만). 경로 첫 폴더 = tenant_id 로 접근을 가른다.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', false, 20971520, array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime'])
    on conflict (id) do nothing;
    execute $p$ create policy media_objects_select on storage.objects for select to authenticated
      using (bucket_id = 'media' and app.has_perm(((storage.foldername(name))[1])::uuid, 'content.read')) $p$;
    execute $p$ create policy media_objects_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'media' and app.has_perm(((storage.foldername(name))[1])::uuid, 'content.write')) $p$;
    execute $p$ create policy media_objects_delete on storage.objects for delete to authenticated
      using (bucket_id = 'media' and owner = auth.uid() and app.has_perm(((storage.foldername(name))[1])::uuid, 'content.write')) $p$;
  end if;
end $$;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
