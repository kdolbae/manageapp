-- =============================================================================
-- D5: 배정 — 일자별 시공 캐파, 배정 보드용 조회
-- =============================================================================
create table public.daily_capacity (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  branch_id   uuid references public.branch(id),          -- null = 사업체 전체
  date        date not null,
  max_jobs    int not null check (max_jobs >= 0),
  memo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index daily_capacity_uq on public.daily_capacity (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), date);
create trigger daily_capacity_touch before update on public.daily_capacity for each row execute function app.touch();
create trigger daily_capacity_audit after insert or update or delete on public.daily_capacity for each row execute function app.audit();

alter table public.daily_capacity enable row level security;
create policy daily_capacity_select on public.daily_capacity for select to authenticated using (app.is_member(tenant_id));
create policy daily_capacity_write on public.daily_capacity for all to authenticated
  using (app.has_perm(tenant_id, 'job.assign')) with check (app.has_perm(tenant_id, 'job.assign'));

-- 기사가 특정 날짜에 쉬는 날(휴무) — 배정 보드에서 회색 처리
create table public.technician_off (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id),
  technician_id  uuid not null references public.technician(id) on delete cascade,
  date           date not null,
  reason         text,
  created_at     timestamptz not null default now(),
  unique (technician_id, date)
);
alter table public.technician_off enable row level security;
create policy technician_off_select on public.technician_off for select to authenticated using (app.is_member(tenant_id));
create policy technician_off_write on public.technician_off for all to authenticated
  using (app.has_perm(tenant_id, 'job.assign') or exists (select 1 from public.technician t where t.id = technician_id and t.profile_id = auth.uid()))
  with check (app.has_perm(tenant_id, 'job.assign') or exists (select 1 from public.technician t where t.id = technician_id and t.profile_id = auth.uid()));
create trigger technician_off_audit after insert or update or delete on public.technician_off for each row execute function app.audit();
