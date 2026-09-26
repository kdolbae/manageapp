-- =============================================================================
-- D12: 캠페인 — 광고·SNS 링크마다 UTM 을 붙여 문의→계약까지 유입을 잇는다
--  귀속은 inquiry.utm(utm_campaign/utm_source) 로 화면에서 계산한다 (별도 조인 테이블 없음)
-- =============================================================================

create table public.campaign (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  branch_id     uuid references public.branch(id),
  name          text not null,
  channel       text not null default 'instagram' check (channel in ('instagram','naver','kakao','google','meta','youtube','blog','fair','partner','offline','other')),
  utm_source    text not null,
  utm_medium    text not null default 'social',
  utm_campaign  text not null,
  utm_content   text,
  landing_path  text not null default '/',                 -- 브랜드 페이지 안 경로 또는 절대 URL
  budget        numeric(14,0),
  starts_on     date,
  ends_on       date,
  status        text not null default 'active' check (status in ('draft','active','paused','ended')),
  memo          text,
  created_by    uuid references public.profile(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index campaign_utm_uq on public.campaign (tenant_id, utm_source, utm_campaign, coalesce(utm_content, '')) where deleted_at is null;
create index campaign_tenant_idx on public.campaign (tenant_id, status) where deleted_at is null;

create or replace function app.campaign_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.utm_source := lower(regexp_replace(new.utm_source, '\s+', '_', 'g'));
  new.utm_medium := lower(regexp_replace(new.utm_medium, '\s+', '_', 'g'));
  new.utm_campaign := lower(regexp_replace(new.utm_campaign, '\s+', '_', 'g'));
  return new;
end $$;
create trigger campaign_before_write before insert or update on public.campaign for each row execute function app.campaign_before_write();
create trigger campaign_touch before update on public.campaign for each row execute function app.touch();
create trigger campaign_audit after insert or update or delete on public.campaign for each row execute function app.audit();

alter table public.campaign enable row level security;
create policy campaign_select on public.campaign for select to authenticated using (app.has_perm(tenant_id, 'report.read') or app.has_perm(tenant_id, 'content.publish'));
create policy campaign_write on public.campaign for all to authenticated
  using (app.has_perm(tenant_id, 'content.publish')) with check (app.has_perm(tenant_id, 'content.publish'));

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
