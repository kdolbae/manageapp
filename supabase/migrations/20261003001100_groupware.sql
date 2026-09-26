-- =============================================================================
-- D9/D11: 그룹웨어 — 공지(notice) · 결재(approval_doc/approval_step) · 휴가(leave_request/leave_grant)
--  조직도는 department / job_position / membership 으로 이미 표현된다 (foundation)
-- =============================================================================

create table public.notice (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  branch_id     uuid references public.branch(id),          -- null = 전 지점
  title         text not null,
  body          text,
  pinned        boolean not null default false,
  published_at  timestamptz not null default now(),
  expires_at    timestamptz,
  attachments   jsonb not null default '[]'::jsonb,         -- [{name, url}]
  created_by    uuid references public.profile(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index notice_tenant_idx on public.notice (tenant_id, pinned desc, published_at desc) where deleted_at is null;

create table public.notice_read (
  notice_id   uuid not null references public.notice(id) on delete cascade,
  profile_id  uuid not null references public.profile(id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (notice_id, profile_id)
);

create table public.approval_doc (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id),
  branch_id     uuid references public.branch(id),
  doc_no        text,
  kind          text not null default 'general' check (kind in ('general','purchase','expense','leave','contract_cancel','discount','other')),
  title         text not null,
  body          text,
  amount        numeric(14,0),
  ref_table     text,                                       -- 연결된 기록 (expense, leave_request, contract ...)
  ref_id        uuid,
  requester_id  uuid not null references public.profile(id),
  status        text not null default 'draft' check (status in ('draft','submitted','approved','rejected','canceled')),
  current_step  int not null default 0,
  submitted_at  timestamptz,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index approval_doc_tenant_idx on public.approval_doc (tenant_id, status, created_at desc) where deleted_at is null;
create index approval_doc_requester_idx on public.approval_doc (requester_id, created_at desc) where deleted_at is null;

create table public.approval_step (
  id           uuid primary key default gen_random_uuid(),
  doc_id       uuid not null references public.approval_doc(id) on delete cascade,
  tenant_id    uuid not null references public.tenant(id),
  step_no      int not null,
  approver_id  uuid not null references public.profile(id),
  status       text not null default 'waiting' check (status in ('waiting','pending','approved','rejected','skipped')),
  comment      text,
  decided_at   timestamptz,
  unique (doc_id, step_no)
);
create index approval_step_approver_idx on public.approval_step (approver_id, status);

create table public.leave_grant (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  profile_id  uuid not null references public.profile(id),
  year        int not null,
  days        numeric(5,1) not null,
  memo        text,
  created_by  uuid references public.profile(id),
  created_at  timestamptz not null default now(),
  unique (tenant_id, profile_id, year)
);

create table public.leave_request (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id),
  branch_id   uuid references public.branch(id),
  profile_id  uuid not null references public.profile(id),
  kind        text not null default 'annual' check (kind in ('annual','half_am','half_pm','sick','family','unpaid','other')),
  start_date  date not null,
  end_date    date not null check (end_date >= start_date),
  days        numeric(5,1) not null check (days > 0),
  reason      text,
  status      text not null default 'pending' check (status in ('pending','approved','rejected','canceled')),
  decided_by  uuid references public.profile(id),
  decided_at  timestamptz,
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index leave_request_tenant_idx on public.leave_request (tenant_id, start_date desc);
create index leave_request_profile_idx on public.leave_request (profile_id, start_date desc);

-- 휴가 잔여: 부여 − 승인된 사용
create or replace view public.leave_balance with (security_invoker = true) as
select g.tenant_id, g.profile_id, g.year, g.days as granted,
       coalesce((select sum(r.days) from public.leave_request r
                 where r.tenant_id = g.tenant_id and r.profile_id = g.profile_id and r.status = 'approved'
                   and extract(year from r.start_date) = g.year and r.kind in ('annual','half_am','half_pm')), 0) as used
from public.leave_grant g;
grant select on public.leave_balance to authenticated;

-- -----------------------------------------------------------------------------
-- 결재 흐름: 상신하면 1단계가 pending, 승인하면 다음 단계, 마지막이면 문서 승인. 반려는 즉시 문서 반려.
-- -----------------------------------------------------------------------------
create sequence if not exists public.approval_seq;
create or replace function app.approval_doc_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.requester_id := coalesce(new.requester_id, auth.uid());
    if new.doc_no is null then new.doc_no := 'A' || to_char(now(), 'YY') || '-' || lpad(nextval('public.approval_seq')::text, 4, '0'); end if;
  end if;
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then
    if not exists (select 1 from public.approval_step s where s.doc_id = new.id) and tg_op = 'UPDATE' then
      raise exception '결재선을 먼저 정해 주세요';
    end if;
    new.submitted_at := now();
    new.current_step := 1;
  end if;
  if new.status in ('approved','rejected','canceled') and (tg_op = 'INSERT' or old.status not in ('approved','rejected','canceled')) then
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger approval_doc_before_write before insert or update on public.approval_doc for each row execute function app.approval_doc_before_write();

create or replace function app.approval_doc_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  if new.status = 'submitted' and old.status <> 'submitted' then
    update public.approval_step
       set status = case when step_no = 1 then 'pending' else 'waiting' end, comment = null, decided_at = null
     where doc_id = new.id;
    select approver_id into a from public.approval_step where doc_id = new.id and step_no = 1;
    if a is not null then
      insert into public.inapp_notification (tenant_id, profile_id, kind, title, body, link)
      values (new.tenant_id, a, 'approval.requested', '결재 요청: ' || new.title, left(coalesce(new.body, ''), 120), '/groupware/approvals/' || new.id);
    end if;
  elsif new.status in ('approved','rejected') and old.status = 'submitted' then
    insert into public.inapp_notification (tenant_id, profile_id, kind, title, body, link)
    values (new.tenant_id, new.requester_id, 'approval.decided', case when new.status = 'approved' then '승인됨: ' else '반려됨: ' end || new.title, null, '/groupware/approvals/' || new.id);
  elsif new.status = 'canceled' and old.status = 'submitted' then
    -- 상신 취소: 남은 단계는 건너뜀 처리 (결재자의 할 일 목록에서 사라진다)
    update public.approval_step set status = 'skipped' where doc_id = new.id and status in ('waiting','pending');
  end if;
  return new;
end $$;
create trigger approval_doc_after_update after update on public.approval_doc for each row execute function app.approval_doc_after_update();

create or replace function app.approval_step_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.approval_doc where id = new.doc_id;
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    if old.status <> 'pending' then raise exception '지금 결재 차례가 아닙니다' using errcode = '42501'; end if;
    if new.approver_id <> auth.uid() and not app.is_owner(new.tenant_id) then raise exception '이 단계의 결재자가 아닙니다' using errcode = '42501'; end if;
    if not app.has_perm(new.tenant_id, 'approval.decide') then raise exception '결재 권한이 없습니다' using errcode = '42501'; end if;
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger approval_step_before_update before update on public.approval_step for each row execute function app.approval_step_before_update();

create or replace function app.approval_step_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare nxt record; d record;
begin
  if new.status = old.status then return new; end if;
  select * into d from public.approval_doc where id = new.doc_id;
  if new.status = 'rejected' then
    update public.approval_doc set status = 'rejected' where id = new.doc_id and status = 'submitted';
    update public.approval_step set status = 'skipped' where doc_id = new.doc_id and status in ('waiting','pending') and id <> new.id;
  elsif new.status = 'approved' then
    select * into nxt from public.approval_step where doc_id = new.doc_id and step_no > new.step_no order by step_no limit 1;
    if nxt is null then
      update public.approval_doc set status = 'approved' where id = new.doc_id and status = 'submitted';
    else
      update public.approval_step set status = 'pending' where id = nxt.id;
      update public.approval_doc set current_step = nxt.step_no where id = new.doc_id;
      insert into public.inapp_notification (tenant_id, profile_id, kind, title, body, link)
      values (d.tenant_id, nxt.approver_id, 'approval.requested', '결재 요청: ' || d.title, left(coalesce(d.body, ''), 120), '/groupware/approvals/' || d.id);
    end if;
  end if;
  return new;
end $$;
create trigger approval_step_after_update after update on public.approval_step for each row execute function app.approval_step_after_update();

-- 휴가: 결정은 approval.decide 가 있어야, 본인은 취소만
create or replace function app.leave_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.profile_id := coalesce(new.profile_id, auth.uid());
    if new.profile_id <> auth.uid() and not app.has_perm(new.tenant_id, 'approval.decide') then
      raise exception '다른 사람의 휴가는 결재 권한이 있어야 올릴 수 있습니다' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if new.status in ('approved','rejected') then
      if not app.has_perm(new.tenant_id, 'approval.decide') then raise exception '휴가 결재 권한이 없습니다' using errcode = '42501'; end if;
      new.decided_by := auth.uid(); new.decided_at := now();
    elsif new.status = 'canceled' and old.status = 'approved' and not app.has_perm(new.tenant_id, 'approval.decide') then
      raise exception '승인된 휴가 취소는 결재자에게 요청하세요' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger leave_before_write before insert or update on public.leave_request for each row execute function app.leave_before_write();

create or replace function app.leave_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved','rejected') and old.status = 'pending' then
    insert into public.inapp_notification (tenant_id, profile_id, kind, title, link)
    values (new.tenant_id, new.profile_id, 'leave.decided', case when new.status = 'approved' then '휴가 승인 ' else '휴가 반려 ' end || to_char(new.start_date, 'MM.DD'), '/groupware/leave');
  end if;
  return new;
end $$;
create trigger leave_after_update after update on public.leave_request for each row execute function app.leave_after_update();

create or replace function app.notice_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;
create trigger notice_before_write before insert or update on public.notice for each row execute function app.notice_before_write();

do $$
declare t text;
begin
  foreach t in array array['notice','approval_doc','leave_request'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['notice','approval_doc','approval_step','leave_request','leave_grant'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.notice        enable row level security;
alter table public.notice_read   enable row level security;
alter table public.approval_doc  enable row level security;
alter table public.approval_step enable row level security;
alter table public.leave_grant   enable row level security;
alter table public.leave_request enable row level security;

create policy notice_select on public.notice for select to authenticated
  using (app.is_member(tenant_id) and (branch_id is null or app.in_scope(tenant_id, branch_id, null)));
create policy notice_write on public.notice for all to authenticated
  using (app.has_perm(tenant_id, 'notice.write') and app.in_scope(tenant_id, branch_id, created_by, true))
  with check (app.has_perm(tenant_id, 'notice.write') and app.in_scope(tenant_id, branch_id, created_by, true));
create policy notice_read_own on public.notice_read for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy notice_read_stats on public.notice_read for select to authenticated
  using (exists (select 1 from public.notice n where n.id = notice_id and app.has_perm(n.tenant_id, 'notice.write')));

-- 결재선에 내가 있는가 (정책끼리 서로 참조하면 재귀가 나므로 security definer 로 읽는다)
create or replace function app.is_approver(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.approval_step s where s.doc_id = p_doc and s.approver_id = auth.uid())
$$;
create policy approval_doc_select on public.approval_doc for select to authenticated
  using (requester_id = auth.uid()
         or app.is_approver(id)
         or (app.has_perm(tenant_id, 'approval.decide') and app.in_scope(tenant_id, branch_id, requester_id)));
create policy approval_doc_insert on public.approval_doc for insert to authenticated
  with check (app.has_perm(tenant_id, 'approval.write') and (requester_id = auth.uid()));
create policy approval_doc_update on public.approval_doc for update to authenticated
  using (requester_id = auth.uid() or app.is_owner(tenant_id))
  with check (app.is_member(tenant_id));

create policy approval_step_select on public.approval_step for select to authenticated
  using (exists (select 1 from public.approval_doc d where d.id = doc_id));
create policy approval_step_insert on public.approval_step for insert to authenticated
  with check (exists (select 1 from public.approval_doc d where d.id = doc_id and d.requester_id = auth.uid() and d.status = 'draft'));
create policy approval_step_update on public.approval_step for update to authenticated
  using (approver_id = auth.uid() or app.is_owner(tenant_id)
         or exists (select 1 from public.approval_doc d where d.id = doc_id and d.requester_id = auth.uid() and d.status = 'draft'))
  with check (app.is_member(tenant_id));
create policy approval_step_delete on public.approval_step for delete to authenticated
  using (exists (select 1 from public.approval_doc d where d.id = doc_id and d.requester_id = auth.uid() and d.status = 'draft'));

create policy leave_grant_select on public.leave_grant for select to authenticated
  using (profile_id = auth.uid() or (app.has_perm(tenant_id, 'approval.decide') and app.is_member(tenant_id)));
create policy leave_grant_write on public.leave_grant for all to authenticated
  using (app.has_perm(tenant_id, 'member.manage')) with check (app.has_perm(tenant_id, 'member.manage'));

create policy leave_request_select on public.leave_request for select to authenticated
  using (profile_id = auth.uid() or (app.has_perm(tenant_id, 'approval.decide') and app.in_scope(tenant_id, branch_id, profile_id))
         or (app.is_member(tenant_id) and status = 'approved'));   -- 승인된 휴가는 일정 공유용으로 모두 본다
create policy leave_request_insert on public.leave_request for insert to authenticated
  with check (app.is_member(tenant_id));
create policy leave_request_update on public.leave_request for update to authenticated
  using (profile_id = auth.uid() or (app.has_perm(tenant_id, 'approval.decide') and app.in_scope(tenant_id, branch_id, profile_id, true)))
  with check (app.is_member(tenant_id));

-- -----------------------------------------------------------------------------
-- 조직도 보정: 부서·직위 관리는 구성원 관리 권한(member.manage)으로도 가능 (지점장 포함).
-- 쓰이지 않는 hr.manage 는 카탈로그에서 뺀다. 부서를 지우면 소속 구성원은 미배정, 하위 부서는 상위로 올린다.
-- -----------------------------------------------------------------------------
drop policy if exists department_write on public.department;
create policy department_write on public.department for all to authenticated
  using (app.has_perm(tenant_id, 'member.manage') or app.has_perm(tenant_id, 'tenant.manage'))
  with check (app.has_perm(tenant_id, 'member.manage') or app.has_perm(tenant_id, 'tenant.manage'));
drop policy if exists position_write on public.job_position;
create policy position_write on public.job_position for all to authenticated
  using (app.has_perm(tenant_id, 'member.manage') or app.has_perm(tenant_id, 'tenant.manage'))
  with check (app.has_perm(tenant_id, 'member.manage') or app.has_perm(tenant_id, 'tenant.manage'));
delete from public.role_permission where permission = 'hr.manage';
delete from public.permission_catalog where code = 'hr.manage';

create or replace function app.department_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.membership set department_id = null where department_id = new.id;
    update public.department set parent_id = new.parent_id where parent_id = new.id and deleted_at is null;
  end if;
  return new;
end $$;
create trigger department_after_update after update on public.department for each row execute function app.department_after_update();

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
