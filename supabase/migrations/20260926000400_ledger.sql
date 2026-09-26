-- =============================================================================
-- D4: 원장 — 입금·환불·할인·매출취소를 이벤트로 기록하고 잔액은 계산한다. 삭제 대신 취소(void).
--  판매 금액의 기준은 품목(contract_line.amount)이고, 원장에는 계약 뒤의 조정(할인·상품권·매출취소·조정)과
--  수납(계약금·중도금·잔금·환불)만 쌓인다.
-- =============================================================================

create table public.ledger_entry (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  contract_id      uuid not null references public.contract(id),
  line_id          uuid references public.contract_line(id),   -- 품목 귀속(선택)
  job_id           uuid references public.job(id),             -- 현장 수납 시 시공 건
  entry_type       text not null check (entry_type in
                     ('discount','voucher','sales_cancel','adjust',          -- 판매 조정 (adjust 만 +)
                      'deposit','interim','balance','refund')),              -- 수납 (refund 만 -)
  amount           numeric(14,0) not null check (amount > 0),
  pay_method_code  text,                                        -- code_value(pay_method)
  occurred_at      timestamptz not null default now(),
  received_by      uuid references public.profile(id),         -- 수납자
  receipt_no       text,
  memo             text,
  voided_at        timestamptz,
  voided_by        uuid references public.profile(id),
  void_reason      text,
  created_by       uuid references public.profile(id),
  created_at       timestamptz not null default now()
);
create index ledger_entry_contract_idx on public.ledger_entry (contract_id) where voided_at is null;
create index ledger_entry_tenant_time_idx on public.ledger_entry (tenant_id, occurred_at desc);

-- 부호: 판매 조정은 -, adjust 는 +, 수납은 +, refund 는 -
create or replace function public.ledger_sign(p_type text) returns int
language sql immutable as $$
  select case p_type when 'adjust' then 1 when 'refund' then -1
              when 'discount' then -1 when 'voucher' then -1 when 'sales_cancel' then -1 else 1 end
$$;
create or replace function public.ledger_side(p_type text) returns text
language sql immutable as $$
  select case when p_type in ('discount','voucher','sales_cancel','adjust') then 'sale' else 'payment' end
$$;

-- 계약 요약(목록·집계용). security_invoker 라 RLS 가 그대로 적용된다.
create or replace view public.contract_summary with (security_invoker = true) as
select
  c.id, c.tenant_id, c.branch_id, c.contract_no, c.customer_id, c.site_id, c.partner_id,
  c.contract_date, c.approval_status, c.canceled_at, c.sales_owner_id, c.intake_type_code, c.source_code, c.created_at,
  cu.name                                                             as customer_name,
  cu.phone                                                            as customer_phone,
  s.name                                                              as site_name,
  nullif(concat_ws(' ', s.dong || '동', s.ho || '호'), '')            as site_unit,
  public.contract_status(c.id)                                        as status,
  coalesce(l.total, 0)                                                as line_total,
  coalesce(adj.total, 0)                                              as adjust_total,
  coalesce(l.total, 0) + coalesce(adj.total, 0)                       as sale_total,
  coalesce(p.total, 0)                                                as paid_total,
  coalesce(l.total, 0) + coalesce(adj.total, 0) - coalesce(p.total, 0) as balance,
  coalesce(j.job_count, 0)                                            as job_count,
  coalesce(j.done_count, 0)                                           as done_count,
  j.next_date
from public.contract c
left join public.customer cu on cu.id = c.customer_id
left join public.site s on s.id = c.site_id
left join lateral (select sum(amount) as total from public.contract_line where contract_id = c.id) l on true
left join lateral (
  select sum(public.ledger_sign(entry_type) * amount) as total from public.ledger_entry
  where contract_id = c.id and voided_at is null and public.ledger_side(entry_type) = 'sale') adj on true
left join lateral (
  select sum(public.ledger_sign(entry_type) * amount) as total from public.ledger_entry
  where contract_id = c.id and voided_at is null and public.ledger_side(entry_type) = 'payment') p on true
left join lateral (
  select count(*) filter (where status <> 'canceled') as job_count,
         count(*) filter (where status = 'done') as done_count,
         min(scheduled_date) filter (where status in ('scheduled','assigned','postponed') and scheduled_date >= current_date) as next_date
  from public.job where contract_id = c.id and deleted_at is null) j on true
where c.deleted_at is null;
grant select on public.contract_summary to authenticated;

-- 시공 건별 기사 화면용: 계약 잔액을 붙인 시공 건
create or replace view public.job_summary with (security_invoker = true) as
select j.*, s.contract_no, s.customer_id, s.customer_name, s.customer_phone, s.site_id, s.site_name, s.site_unit,
       s.sale_total, s.paid_total, s.balance, s.approval_status,
       t.name as technician_name
from public.job j
join public.contract_summary s on s.id = j.contract_id
left join public.technician t on t.id = j.technician_id
where j.deleted_at is null;
grant select on public.job_summary to authenticated;

-- 원장은 수정하지 않는다: 취소(void) 필드만 바꿀 수 있다
create or replace function app.guard_ledger_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount <> old.amount or new.entry_type <> old.entry_type or new.contract_id <> old.contract_id
     or new.line_id is distinct from old.line_id or new.job_id is distinct from old.job_id
     or new.occurred_at <> old.occurred_at or new.pay_method_code is distinct from old.pay_method_code
     or new.received_by is distinct from old.received_by or new.memo is distinct from old.memo
     or new.receipt_no is distinct from old.receipt_no then
    raise exception 'ledger entries are immutable; void and re-enter' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    raise exception 'entry already voided' using errcode = '42501';
  end if;
  if new.voided_at is not null then
    if auth.uid() is not null and not app.has_perm(new.tenant_id, 'ledger.void') then
      raise exception 'ledger.void permission required' using errcode = '42501';
    end if;
    new.voided_by := coalesce(auth.uid(), new.voided_by);
  end if;
  return new;
end $$;
create trigger ledger_guard_update before update on public.ledger_entry for each row execute function app.guard_ledger_update();

create or replace function app.ledger_before_insert() returns trigger
language plpgsql as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.received_by is null and public.ledger_side(new.entry_type) = 'payment' then new.received_by := auth.uid(); end if;
  return new;
end $$;
create trigger ledger_before_insert before insert on public.ledger_entry for each row execute function app.ledger_before_insert();
create trigger ledger_entry_audit after insert or update or delete on public.ledger_entry for each row execute function app.audit();

alter table public.ledger_entry enable row level security;
-- 조회: 원장 조회 권한 + 계약이 보이면
create policy ledger_select on public.ledger_entry for select to authenticated
  using (app.has_perm(tenant_id, 'ledger.read') and exists (select 1 from public.contract c where c.id = contract_id));
-- 기록: 원장 기록 권한 + 계약이 보이면 + (본인 범위 사용자는 본인이 수납자)
create policy ledger_insert on public.ledger_entry for insert to authenticated
  with check (app.has_perm(tenant_id, 'ledger.write')
          and exists (select 1 from public.contract c where c.id = contract_id)
          and app.in_scope(tenant_id, (select c.branch_id from public.contract c where c.id = contract_id), received_by, true));
-- 취소: 계약이 보이면 (권한은 트리거가 확인)
create policy ledger_update on public.ledger_entry for update to authenticated
  using (app.has_perm(tenant_id, 'ledger.void') and exists (select 1 from public.contract c where c.id = contract_id))
  with check (app.has_perm(tenant_id, 'ledger.void'));

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
