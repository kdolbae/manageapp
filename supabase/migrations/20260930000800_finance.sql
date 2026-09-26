-- =============================================================================
-- D8: ERP-lite — 경비(expense) · 기사 정산(payout) · 경비 분류 기본값
--  - 손익은 계약(매출) − 품목 기사비 − 경비 로 화면에서 계산한다 (별도 테이블 없음)
--  - 정산서는 완료된 시공 건의 품목 기사비 스냅샷을 모아 만든다. 확정 뒤에는 줄을 못 바꾼다
-- =============================================================================

create table public.expense (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  branch_id        uuid references public.branch(id),
  category_code    text not null,                          -- code_value(expense_category)
  amount           numeric(14,0) not null check (amount > 0),  -- 공급가+부가세 합계(영수증 금액)
  vat              numeric(14,0) not null default 0 check (vat >= 0),
  occurred_on      date not null default current_date,
  vendor           text,
  memo             text,
  pay_method_code  text,                                   -- code_value(pay_method)
  contract_id      uuid references public.contract(id),
  job_id           uuid references public.job(id),
  receipt_media_id uuid references public.media_asset(id),
  status           text not null default 'submitted' check (status in ('draft','submitted','approved','rejected','paid')),
  reject_reason    text,
  created_by       uuid references public.profile(id),
  approved_by      uuid references public.profile(id),
  approved_at      timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index expense_tenant_idx on public.expense (tenant_id, occurred_on desc) where deleted_at is null;
create index expense_creator_idx on public.expense (created_by, status) where deleted_at is null;

create table public.payout (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id),
  branch_id      uuid references public.branch(id),
  technician_id  uuid not null references public.technician(id),
  period_from    date not null,
  period_to      date not null check (period_to >= period_from),
  rate_type      text not null default 'rate_3_3' check (rate_type in ('rate_3_3','daily','invoice')),
  gross          numeric(14,0) not null default 0,        -- 지급 대상 합계
  withholding    numeric(14,0) not null default 0,        -- 3.3% 원천징수
  vat            numeric(14,0) not null default 0,        -- 계산서 발행 시 부가세
  net            numeric(14,0) not null default 0,        -- 실지급액 = gross - withholding + vat
  status         text not null default 'draft' check (status in ('draft','confirmed','paid')),
  confirmed_by   uuid references public.profile(id),
  confirmed_at   timestamptz,
  paid_at        timestamptz,
  pay_method_code text,
  memo           text,
  created_by     uuid references public.profile(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index payout_tenant_idx on public.payout (tenant_id, period_from desc);
create index payout_technician_idx on public.payout (technician_id, period_from desc);

create table public.payout_line (
  id           uuid primary key default gen_random_uuid(),
  payout_id    uuid not null references public.payout(id) on delete cascade,
  tenant_id    uuid not null references public.tenant(id),
  kind         text not null default 'job' check (kind in ('job','daily','extra','deduct')),
  job_id       uuid references public.job(id),
  line_id      uuid references public.contract_line(id),
  contract_id  uuid references public.contract(id),
  work_on      date,
  amount       numeric(14,0) not null,                    -- 공제(deduct)는 음수
  memo         text,
  created_at   timestamptz not null default now()
);
create unique index payout_line_job_uq on public.payout_line (job_id, line_id) where job_id is not null and line_id is not null;
create index payout_line_payout_idx on public.payout_line (payout_id);

-- -----------------------------------------------------------------------------
-- 경비 분류 기본값 (새 사업체마다 자동, 기존 사업체에도 채움)
-- -----------------------------------------------------------------------------
create or replace function app.seed_finance_defaults(tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.code_value (tenant_id, domain, code, label, color, sort_order) values
    (tid, 'expense_category', 'material',  '자재·코팅제',   null, 1),
    (tid, 'expense_category', 'vehicle',   '차량·유류',     null, 2),
    (tid, 'expense_category', 'labor',     '인건비·일당',   null, 3),
    (tid, 'expense_category', 'marketing', '광고·마케팅',   null, 4),
    (tid, 'expense_category', 'rent',      '임차료·관리비', null, 5),
    (tid, 'expense_category', 'telecom',   '통신·소프트웨어', null, 6),
    (tid, 'expense_category', 'meal',      '식대·복리후생', null, 7),
    (tid, 'expense_category', 'tool',      '공구·비품',     null, 8),
    (tid, 'expense_category', 'tax',       '세금·수수료',   null, 9),
    (tid, 'expense_category', 'etc',       '기타',          null, 99)
  on conflict (tenant_id, domain, code) do nothing;
end $$;
select app.seed_finance_defaults(id) from public.tenant;
create or replace function app.tenant_seed_finance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.seed_finance_defaults(new.id);
  return new;
end $$;
create trigger tenant_seed_finance after insert on public.tenant for each row execute function app.tenant_seed_finance();

-- -----------------------------------------------------------------------------
-- 트리거: 경비 상태 전이 권한, 정산 합계 재계산, 확정 뒤 잠금
-- -----------------------------------------------------------------------------
create or replace function app.expense_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.status in ('approved','rejected','paid') and not app.has_perm(new.tenant_id, 'expense.approve') then
      raise exception '경비 결재 권한이 필요합니다' using errcode = '42501';
    end if;
  else
    if new.status is distinct from old.status then
      if new.status in ('approved','rejected','paid') and not app.has_perm(new.tenant_id, 'expense.approve') then
        raise exception '경비 결재 권한이 필요합니다' using errcode = '42501';
      end if;
      if new.status in ('approved','rejected') then new.approved_by := auth.uid(); new.approved_at := now(); end if;
      if new.status = 'paid' then new.paid_at := coalesce(new.paid_at, now()); end if;
    elsif old.status in ('approved','paid') and (new.amount <> old.amount or new.occurred_on <> old.occurred_on or new.category_code <> old.category_code)
          and not app.has_perm(new.tenant_id, 'expense.approve') then
      raise exception '결재된 경비는 금액·일자·분류를 바꿀 수 없습니다' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger expense_before_write before insert or update on public.expense for each row execute function app.expense_before_write();

create or replace function app.payout_recalc(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g numeric; rt text; w numeric; v numeric;
begin
  select coalesce(sum(amount), 0) into g from public.payout_line where payout_id = pid;
  select rate_type into rt from public.payout where id = pid;
  w := case when rt = 'rate_3_3' then round(g * 0.033) else 0 end;
  v := case when rt = 'invoice' then round(g * 0.1) else 0 end;
  update public.payout set gross = g, withholding = w, vat = v, net = g - w + v where id = pid;
end $$;

create or replace function app.payout_line_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.payout where id = old.payout_id) then perform app.payout_recalc(old.payout_id); end if;
    return old;
  end if;
  perform app.payout_recalc(new.payout_id);
  return new;
end $$;
create trigger payout_line_after_write after insert or update or delete on public.payout_line for each row execute function app.payout_line_after_write();

create or replace function app.payout_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from public.payout where id = coalesce(new.payout_id, old.payout_id);
  if st is not null and st <> 'draft' then
    raise exception '확정된 정산서는 줄을 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger payout_line_guard before insert or update or delete on public.payout_line for each row execute function app.payout_line_guard();

create or replace function app.payout_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  elsif new.status is distinct from old.status then
    if new.status = 'confirmed' then new.confirmed_by := auth.uid(); new.confirmed_at := now(); end if;
    if new.status = 'paid' then new.paid_at := coalesce(new.paid_at, now()); end if;
    if new.status = 'draft' and old.status = 'paid' then
      raise exception '지급된 정산서는 되돌릴 수 없습니다' using errcode = '42501';
    end if;
  elsif old.status <> 'draft' and (new.rate_type <> old.rate_type or new.period_from <> old.period_from or new.period_to <> old.period_to or new.technician_id <> old.technician_id) then
    raise exception '확정된 정산서는 기간·시공자를 바꿀 수 없습니다' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger payout_before_write before insert or update on public.payout for each row execute function app.payout_before_write();

do $$
declare t text;
begin
  foreach t in array array['expense','payout'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch()', t || '_touch', t);
  end loop;
  foreach t in array array['expense','payout','payout_line'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 시공 건이 맡은 품목: job_line 이 있으면 그것, 없으면 같은 작업 단위의 계약 품목(작업 단위가 없으면 전부)
-- -----------------------------------------------------------------------------
create or replace function app.job_line_ids(p_job uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select jl.line_id from public.job_line jl where jl.job_id = p_job
  union
  select cl.id from public.job j join public.contract_line cl on cl.contract_id = j.contract_id
  where j.id = p_job and not exists (select 1 from public.job_line x where x.job_id = p_job)
    and (j.work_area_code is null or cl.work_area_code is null or cl.work_area_code = j.work_area_code)
$$;

-- -----------------------------------------------------------------------------
-- 정산서 만들기: 기간 안에 완료된 시공 건의 품목 기사비를 모은다 (같은 품목을 여러 시공 건이 나눠 맡으면 건수로 나눈다)
-- -----------------------------------------------------------------------------
create or replace function public.build_payout(p_tenant uuid, p_technician uuid, p_from date, p_to date) returns uuid
language plpgsql security invoker set search_path = public as $$
declare pid uuid; t record;
begin
  if not app.has_perm(p_tenant, 'payout.approve') then
    raise exception '정산 권한이 없습니다' using errcode = '42501';
  end if;
  select * into t from public.technician where id = p_technician and tenant_id = p_tenant and deleted_at is null;
  if t is null then raise exception '시공자를 찾지 못했습니다'; end if;
  insert into public.payout (tenant_id, branch_id, technician_id, period_from, period_to, rate_type)
  values (p_tenant, t.branch_id, p_technician, p_from, p_to, t.rate_type) returning id into pid;
  insert into public.payout_line (payout_id, tenant_id, kind, job_id, line_id, contract_id, work_on, amount, memo)
  select pid, p_tenant, 'job', j.id, cl.id, j.contract_id, coalesce(j.completed_at::date, j.scheduled_date),
         round(cl.technician_rate / greatest(1, (select count(*) from public.job j2
                                                 where j2.contract_id = j.contract_id and j2.deleted_at is null and j2.status <> 'canceled'
                                                   and cl.id in (select app.job_line_ids(j2.id))))),
         cl.name
  from public.job j
  cross join lateral app.job_line_ids(j.id) as l(line_id)
  join public.contract_line cl on cl.id = l.line_id
  where j.tenant_id = p_tenant and j.technician_id = p_technician and j.deleted_at is null and j.status = 'done'
    and coalesce(j.completed_at::date, j.scheduled_date) between p_from and p_to
    and cl.technician_rate <> 0
    and not exists (select 1 from public.payout_line pl where pl.job_id = j.id and pl.line_id = cl.id);
  return pid;
end $$;
grant execute on function public.build_payout(uuid, uuid, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.expense     enable row level security;
alter table public.payout      enable row level security;
alter table public.payout_line enable row level security;

create policy expense_select on public.expense for select to authenticated
  using (created_by = auth.uid()
         or ((app.has_perm(tenant_id, 'finance.read') or app.has_perm(tenant_id, 'expense.approve')) and app.in_scope(tenant_id, branch_id, created_by)));
create policy expense_insert on public.expense for insert to authenticated
  with check (app.has_perm(tenant_id, 'expense.write') and app.is_member(tenant_id) and (created_by is null or created_by = auth.uid()));
create policy expense_update on public.expense for update to authenticated
  using ((created_by = auth.uid() and status in ('draft','submitted','rejected'))
         or (app.has_perm(tenant_id, 'expense.approve') and app.in_scope(tenant_id, branch_id, created_by, true)))
  with check (app.is_member(tenant_id));

create policy payout_select on public.payout for select to authenticated
  using ((app.has_perm(tenant_id, 'payout.read') and app.in_scope(tenant_id, branch_id, null))
         or exists (select 1 from public.technician t where t.id = technician_id and t.profile_id = auth.uid()));
create policy payout_write on public.payout for insert to authenticated
  with check (app.has_perm(tenant_id, 'payout.approve') and app.in_scope(tenant_id, branch_id, null, true));
create policy payout_update on public.payout for update to authenticated
  using (app.has_perm(tenant_id, 'payout.approve') and app.in_scope(tenant_id, branch_id, null, true))
  with check (app.has_perm(tenant_id, 'payout.approve'));
create policy payout_delete on public.payout for delete to authenticated
  using (status = 'draft' and app.has_perm(tenant_id, 'payout.approve') and app.in_scope(tenant_id, branch_id, null, true));

create policy payout_line_select on public.payout_line for select to authenticated
  using (exists (select 1 from public.payout p where p.id = payout_id));
create policy payout_line_write on public.payout_line for all to authenticated
  using (app.has_perm(tenant_id, 'payout.approve') and exists (select 1 from public.payout p where p.id = payout_id))
  with check (app.has_perm(tenant_id, 'payout.approve') and exists (select 1 from public.payout p where p.id = payout_id));

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
