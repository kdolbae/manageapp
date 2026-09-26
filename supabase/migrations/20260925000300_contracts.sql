-- =============================================================================
-- D3: 계약 코어 — 계약(계약자 × 현장) / 품목(금액) / 시공 건(날짜·담당·상태) / 배정 이력
--  - 계약 상태는 저장하지 않고 시공 건에서 계산한다 (public.contract_status).
--  - 금액은 품목에, 날짜·담당·상태는 시공 건에. 한 계약 안에 시공 건이 몇 개든 각자 상태를 갖는다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 계약 번호 채번 (사업체·연도별 순번: C26-0001)
-- -----------------------------------------------------------------------------
create table public.contract_seq (
  tenant_id  uuid not null references public.tenant(id),
  year       int  not null,
  last_no    int  not null default 0,
  primary key (tenant_id, year)
);
alter table public.contract_seq enable row level security;   -- 직접 접근 없음(함수만)

create or replace function app.next_contract_no(tid uuid, d date default current_date) returns text
language plpgsql security definer set search_path = public as $$
declare y int := extract(year from d)::int; n int;
begin
  insert into public.contract_seq (tenant_id, year, last_no) values (tid, y, 1)
  on conflict (tenant_id, year) do update set last_no = public.contract_seq.last_no + 1
  returning last_no into n;
  return format('C%s-%s', to_char(d, 'YY'), lpad(n::text, 4, '0'));
end $$;

-- -----------------------------------------------------------------------------
-- 2. 계약
-- -----------------------------------------------------------------------------
create table public.contract (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id),
  branch_id         uuid references public.branch(id),
  contract_no       text not null,
  customer_id       uuid not null references public.customer(id),
  site_id           uuid references public.site(id),
  partner_id        uuid references public.partner(id),        -- 발주처(협력업체 발주 건)
  intake_type_code  text,                                      -- code_value(intake_type)
  contract_date     date not null default current_date,
  sales_owner_id    uuid references public.profile(id),        -- 영업 담당
  approval_status   text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by       uuid references public.profile(id),
  approved_at       timestamptz,
  canceled_at       timestamptz,
  cancel_reason     text,
  source_code       text,                                      -- 유입 경로 스냅샷(마케팅 분석)
  memo              text,
  created_by        uuid references public.profile(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (tenant_id, contract_no)
);
create index contract_tenant_date_idx on public.contract (tenant_id, contract_date desc) where deleted_at is null;
create index contract_customer_idx on public.contract (customer_id);

-- -----------------------------------------------------------------------------
-- 3. 품목 (금액은 여기에)
-- -----------------------------------------------------------------------------
create table public.contract_line (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  contract_id      uuid not null references public.contract(id) on delete cascade,
  product_id       uuid references public.product(id),
  name             text not null,                       -- 상품명 스냅샷
  work_area_code   text,                                -- 작업 단위 스냅샷
  qty              numeric(10,2) not null default 1,
  unit_price       numeric(14,0) not null default 0,    -- 판매가 스냅샷(옵션 반영)
  discount         numeric(14,0) not null default 0,
  amount           numeric(14,0) generated always as (round(qty * unit_price) - discount) stored,
  technician_rate  numeric(14,0) not null default 0,    -- 기사 시공비 스냅샷
  options          jsonb not null default '[]'::jsonb,  -- [{group, name, price_delta, technician_rate_delta}]
  sort_order       int not null default 0,
  memo             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index contract_line_contract_idx on public.contract_line (contract_id);

-- -----------------------------------------------------------------------------
-- 4. 시공 건 (날짜·담당·상태는 여기에)
-- -----------------------------------------------------------------------------
create table public.job (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  contract_id      uuid not null references public.contract(id) on delete cascade,
  branch_id        uuid references public.branch(id),
  work_area_code   text,
  kind             text not null default 'install' check (kind in ('install','as','repair')),
  status           text not null default 'undecided'
                   check (status in ('undecided','scheduled','assigned','in_progress','done','postponed','canceled')),
  scheduled_date   date,
  time_slot        text not null default 'any' check (time_slot in ('any','am','pm')),
  scheduled_time   time,
  technician_id    uuid references public.technician(id),     -- 주담당(배정 이력은 job_assignment)
  started_at       timestamptz,
  completed_at     timestamptz,
  memo             text,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index job_tenant_date_idx on public.job (tenant_id, scheduled_date) where deleted_at is null;
create index job_contract_idx on public.job (contract_id);
create index job_technician_idx on public.job (technician_id, scheduled_date) where deleted_at is null;

create table public.job_line (
  job_id   uuid not null references public.job(id) on delete cascade,
  line_id  uuid not null references public.contract_line(id) on delete cascade,
  primary key (job_id, line_id)
);

create table public.job_assignment (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id),
  job_id         uuid not null references public.job(id) on delete cascade,
  technician_id  uuid not null references public.technician(id),
  role           text not null default 'lead' check (role in ('lead','helper')),
  assigned_by    uuid references public.profile(id),
  assigned_at    timestamptz not null default now(),
  unassigned_at  timestamptz,
  note           text
);
create index job_assignment_job_idx on public.job_assignment (job_id) where unassigned_at is null;

-- -----------------------------------------------------------------------------
-- 5. 계산: 계약 상태 / 시공 건 소유자
-- -----------------------------------------------------------------------------
-- 계약 상태 = 시공 건 상태의 요약. canceled > pending_approval > (all done) done > in_progress > scheduled > undecided
create or replace function public.contract_status(p_contract uuid) returns text
language sql stable security invoker set search_path = public as $$
  select case
    when c.canceled_at is not null then 'canceled'
    when c.approval_status = 'rejected' then 'rejected'
    when c.approval_status = 'pending' then 'pending_approval'
    when (select count(*) from public.job j where j.contract_id = c.id and j.deleted_at is null and j.status <> 'canceled') = 0 then 'no_job'
    when not exists (select 1 from public.job j where j.contract_id = c.id and j.deleted_at is null and j.status not in ('done','canceled')) then 'done'
    when exists (select 1 from public.job j where j.contract_id = c.id and j.deleted_at is null and j.status = 'in_progress') then 'in_progress'
    when exists (select 1 from public.job j where j.contract_id = c.id and j.deleted_at is null and j.status in ('assigned','scheduled')) then 'scheduled'
    when exists (select 1 from public.job j where j.contract_id = c.id and j.deleted_at is null and j.status = 'postponed') then 'postponed'
    else 'undecided' end
  from public.contract c where c.id = p_contract
$$;
grant execute on function public.contract_status(uuid) to authenticated;

-- 시공 건의 담당 기사 계정(own 범위 판정용)
create or replace function app.job_owner(p_job uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.profile_id from public.job j join public.technician t on t.id = j.technician_id where j.id = p_job
$$;

-- 내가(기사 계정) 배정된 계약인가
create or replace function app.is_assigned_technician(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.job j join public.technician t on t.id = j.technician_id
    where j.contract_id = p_contract and j.deleted_at is null and t.profile_id = auth.uid())
$$;

-- -----------------------------------------------------------------------------
-- 6. 트리거: 번호 채번, 상태 이력, 배정 이력, 시각 기록
-- -----------------------------------------------------------------------------
create or replace function app.contract_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.contract_no is null or new.contract_no = '' then
    new.contract_no := app.next_contract_no(new.tenant_id, new.contract_date);
  end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.source_code is null then
    select c.source_code into new.source_code from public.customer c where c.id = new.customer_id;
  end if;
  return new;
end $$;
create trigger contract_before_insert before insert on public.contract for each row execute function app.contract_before_insert();

create or replace function app.contract_status_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.status_history (tenant_id, entity, entity_id, from_status, to_status, actor_id)
    values (new.tenant_id, 'contract_approval', new.id, null, new.approval_status, auth.uid());
  elsif new.approval_status is distinct from old.approval_status then
    insert into public.status_history (tenant_id, entity, entity_id, from_status, to_status, actor_id)
    values (new.tenant_id, 'contract_approval', new.id, old.approval_status, new.approval_status, auth.uid());
  end if;
  if tg_op = 'UPDATE' and new.canceled_at is not null and old.canceled_at is null then
    insert into public.status_history (tenant_id, entity, entity_id, from_status, to_status, actor_id, note)
    values (new.tenant_id, 'contract', new.id, 'active', 'canceled', auth.uid(), new.cancel_reason);
  end if;
  return new;
end $$;
create trigger contract_status_history after insert or update on public.contract for each row execute function app.contract_status_history();

create or replace function app.job_before_write() returns trigger
language plpgsql as $$
begin
  -- 담당·날짜가 정해지면 상태를 자동으로 올린다 (undecided → scheduled → assigned)
  if new.status in ('undecided','scheduled') then
    if new.technician_id is not null and new.scheduled_date is not null then new.status := 'assigned';
    elsif new.scheduled_date is not null then new.status := 'scheduled';
    else new.status := 'undecided';
    end if;
  end if;
  if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'done' and new.completed_at is null then new.completed_at := now(); end if;
  if new.status <> 'done' then new.completed_at := null; end if;
  if new.branch_id is null then
    select c.branch_id into new.branch_id from public.contract c where c.id = new.contract_id;
  end if;
  return new;
end $$;
create trigger job_before_write before insert or update on public.job for each row execute function app.job_before_write();

create or replace function app.job_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.status_history (tenant_id, entity, entity_id, from_status, to_status, actor_id)
    values (new.tenant_id, 'job', new.id, case when tg_op = 'INSERT' then null else old.status end, new.status, auth.uid());
  end if;
  -- 주담당 변경 → 배정 이력
  if tg_op = 'INSERT' and new.technician_id is not null then
    insert into public.job_assignment (tenant_id, job_id, technician_id, role, assigned_by)
    values (new.tenant_id, new.id, new.technician_id, 'lead', auth.uid());
  elsif tg_op = 'UPDATE' and new.technician_id is distinct from old.technician_id then
    update public.job_assignment set unassigned_at = now()
      where job_id = new.id and role = 'lead' and unassigned_at is null;
    if new.technician_id is not null then
      insert into public.job_assignment (tenant_id, job_id, technician_id, role, assigned_by)
      values (new.tenant_id, new.id, new.technician_id, 'lead', auth.uid());
    end if;
  end if;
  return new;
end $$;
create trigger job_after_write after insert or update on public.job for each row execute function app.job_after_write();

do $$
declare t text;
begin
  foreach t in array array['contract','contract_line','job']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['contract','contract_line','job','job_line','job_assignment']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7. RLS
-- -----------------------------------------------------------------------------
alter table public.contract        enable row level security;
alter table public.contract_line   enable row level security;
alter table public.job             enable row level security;
alter table public.job_line        enable row level security;
alter table public.job_assignment  enable row level security;

-- 계약: 범위 안(own = 영업 담당) / 배정된 기사 / 발주한 협력업체 계정
create policy contract_select on public.contract for select to authenticated
  using (app.has_perm(tenant_id, 'contract.read')
     and (app.in_scope(tenant_id, branch_id, sales_owner_id)
          or app.is_assigned_technician(id)
          or (app.my_partner_id(tenant_id) is not null and partner_id = app.my_partner_id(tenant_id))));
create policy contract_insert on public.contract for insert to authenticated
  with check (app.has_perm(tenant_id, 'contract.write') and app.in_scope(tenant_id, branch_id, sales_owner_id, true));
create policy contract_update on public.contract for update to authenticated
  using (app.has_perm(tenant_id, 'contract.write') and app.in_scope(tenant_id, branch_id, sales_owner_id, true))
  with check (app.has_perm(tenant_id, 'contract.write') and app.in_scope(tenant_id, branch_id, sales_owner_id, true));

-- 승인 상태는 승인 권한자만 바꿀 수 있다 (contract.write 만으로는 pending 유지)
create or replace function app.guard_contract_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.approval_status is distinct from old.approval_status and not app.has_perm(new.tenant_id, 'contract.approve') then
    raise exception 'contract.approve permission required' using errcode = '42501';
  end if;
  if new.approval_status is distinct from old.approval_status then
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  return new;
end $$;
create trigger contract_guard_approval before update on public.contract for each row execute function app.guard_contract_approval();

-- 품목: 계약이 보이면 보인다 / 계약 쓰기 권한 + 계약 수정 가능하면 쓴다
create policy contract_line_select on public.contract_line for select to authenticated
  using (exists (select 1 from public.contract c where c.id = contract_id));
create policy contract_line_write on public.contract_line for all to authenticated
  using (app.has_perm(tenant_id, 'contract.write') and exists (select 1 from public.contract c where c.id = contract_id))
  with check (app.has_perm(tenant_id, 'contract.write') and exists (select 1 from public.contract c where c.id = contract_id));

-- 시공 건: 조회 = job.read + (범위 안 / 본인 배정 / 발주 협력업체). 수정 = job.write 범위 안, 기사 본인은 상태·시각만 (job.complete)
create policy job_select on public.job for select to authenticated
  using (app.has_perm(tenant_id, 'job.read')
     and (app.in_scope(tenant_id, branch_id, app.job_owner(id))
          or exists (select 1 from public.contract c where c.id = contract_id and app.my_partner_id(tenant_id) is not null and c.partner_id = app.my_partner_id(tenant_id))));
create policy job_insert on public.job for insert to authenticated
  with check (app.has_perm(tenant_id, 'job.write') and app.in_scope(tenant_id, branch_id, null, true));
create policy job_update on public.job for update to authenticated
  using ((app.has_perm(tenant_id, 'job.write') and app.in_scope(tenant_id, branch_id, null, true))
      or (app.has_perm(tenant_id, 'job.complete') and app.job_owner(id) = auth.uid()))
  with check ((app.has_perm(tenant_id, 'job.write') and app.in_scope(tenant_id, branch_id, null, true))
      or (app.has_perm(tenant_id, 'job.complete') and app.job_owner(id) = auth.uid()));

-- 기사 본인은 상태·시각·메모만 바꿀 수 있다 (배정·날짜 변경은 job.write)
create or replace function app.guard_job_technician_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if app.has_perm(new.tenant_id, 'job.write') and app.in_scope(new.tenant_id, new.branch_id, null, true) then return new; end if;
  if new.technician_id is distinct from old.technician_id or new.scheduled_date is distinct from old.scheduled_date
     or new.contract_id <> old.contract_id or new.work_area_code is distinct from old.work_area_code
     or new.kind <> old.kind or new.time_slot is distinct from old.time_slot then
    raise exception 'technicians may only change status, times and memo' using errcode = '42501';
  end if;
  if new.status not in ('assigned','in_progress','done','postponed') then
    raise exception 'technicians may not set status %', new.status using errcode = '42501';
  end if;
  return new;
end $$;
create trigger job_guard_technician_edit before update on public.job for each row execute function app.guard_job_technician_edit();

-- 배정 권한: technician_id 변경은 job.assign 이 필요
create or replace function app.guard_job_assign() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (tg_op = 'INSERT' and new.technician_id is not null)
     or (tg_op = 'UPDATE' and new.technician_id is distinct from old.technician_id) then
    if not app.has_perm(new.tenant_id, 'job.assign') then
      raise exception 'job.assign permission required' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger job_guard_assign before insert or update on public.job for each row execute function app.guard_job_assign();

create policy job_line_select on public.job_line for select to authenticated
  using (exists (select 1 from public.job j where j.id = job_id));
create policy job_line_write on public.job_line for all to authenticated
  using (exists (select 1 from public.job j where j.id = job_id and app.has_perm(j.tenant_id, 'job.write')))
  with check (exists (select 1 from public.job j where j.id = job_id and app.has_perm(j.tenant_id, 'job.write')));

create policy job_assignment_select on public.job_assignment for select to authenticated
  using (exists (select 1 from public.job j where j.id = job_id));
create policy job_assignment_write on public.job_assignment for all to authenticated
  using (app.has_perm(tenant_id, 'job.assign')) with check (app.has_perm(tenant_id, 'job.assign'));

-- -----------------------------------------------------------------------------
-- 8. RPC: 계약 + 품목 + 시공 건을 한 트랜잭션으로 등록 (RLS 는 호출자 권한으로 적용)
--  p = { tenant_id, branch_id, customer_id, site_id, partner_id, intake_type_code, contract_date, sales_owner_id, memo,
--        lines: [{product_id, name, work_area_code, qty, unit_price, discount, technician_rate, options}],
--        jobs:  [{work_area_code, scheduled_date, time_slot, technician_id, memo, kind}] }
--  각 시공 건은 같은 work_area_code 의 품목과 연결된다 (work_area_code 가 null 이면 모든 품목).
-- -----------------------------------------------------------------------------
create or replace function public.create_contract(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_contract uuid;
  v_line jsonb;
  v_job jsonb;
  v_job_id uuid;
  i int := 0;
begin
  if v_tenant is null or (p->>'customer_id') is null then
    raise exception 'tenant_id and customer_id are required' using errcode = '22023';
  end if;
  insert into public.contract (tenant_id, branch_id, customer_id, site_id, partner_id, intake_type_code, contract_date, sales_owner_id, memo)
  values (v_tenant, (p->>'branch_id')::uuid, (p->>'customer_id')::uuid, (p->>'site_id')::uuid, (p->>'partner_id')::uuid,
          p->>'intake_type_code', coalesce((p->>'contract_date')::date, current_date), (p->>'sales_owner_id')::uuid, p->>'memo')
  returning id into v_contract;

  for v_line in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    i := i + 1;
    insert into public.contract_line (tenant_id, contract_id, product_id, name, work_area_code, qty, unit_price, discount, technician_rate, options, sort_order, memo)
    values (v_tenant, v_contract, (v_line->>'product_id')::uuid, coalesce(v_line->>'name', '품목'), v_line->>'work_area_code',
            coalesce((v_line->>'qty')::numeric, 1), coalesce((v_line->>'unit_price')::numeric, 0), coalesce((v_line->>'discount')::numeric, 0),
            coalesce((v_line->>'technician_rate')::numeric, 0), coalesce(v_line->'options', '[]'::jsonb), i, v_line->>'memo');
  end loop;

  i := 0;
  for v_job in select * from jsonb_array_elements(coalesce(p->'jobs', '[]'::jsonb)) loop
    i := i + 1;
    insert into public.job (tenant_id, contract_id, work_area_code, scheduled_date, time_slot, technician_id, memo, kind, sort_order)
    values (v_tenant, v_contract, v_job->>'work_area_code', (v_job->>'scheduled_date')::date, coalesce(v_job->>'time_slot', 'any'),
            (v_job->>'technician_id')::uuid, v_job->>'memo', coalesce(v_job->>'kind', 'install'), i)
    returning id into v_job_id;
    insert into public.job_line (job_id, line_id)
      select v_job_id, l.id from public.contract_line l
      where l.contract_id = v_contract and ((v_job->>'work_area_code') is null or l.work_area_code = v_job->>'work_area_code');
  end loop;
  return v_contract;
end $$;
grant execute on function public.create_contract(jsonb) to authenticated;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
