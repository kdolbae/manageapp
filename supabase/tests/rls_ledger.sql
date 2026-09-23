-- D4 원장 테스트. rls_contracts.sql 다음에 실행.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as k1 from public.contract where contract_no like 'C26-0001' \gset
select id as t1 from public.tenant where slug = 'nanomaster' \gset

insert into public.ledger_entry (tenant_id, contract_id, entry_type, amount, pay_method_code) values (:'t1', :'k1', 'deposit', 500000, 'transfer');
do $$ begin
  if (select balance from public.contract_summary where contract_no = 'C26-0001') <> 1360000 then raise exception 'balance after deposit'; end if;
  if (select paid_total from public.contract_summary where contract_no = 'C26-0001') <> 500000 then raise exception 'paid_total'; end if;
end $$;

-- C(기사): 배정된 계약의 잔금 수납 가능(received_by = 본인), 취소는 불가
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
insert into public.ledger_entry (tenant_id, contract_id, entry_type, amount, pay_method_code) values (:'t1', :'k1', 'balance', 1360000, 'cash');
do $$ begin
  if (select balance from public.contract_summary where contract_no = 'C26-0001') <> 0 then raise exception 'balance after technician collection'; end if;
  if (select received_by from public.ledger_entry where entry_type = 'balance') <> 'c0000000-0000-4000-8000-000000000003' then raise exception 'received_by default'; end if;
  begin
    update public.ledger_entry set voided_at = now() where entry_type = 'balance';
    if exists (select 1 from public.ledger_entry where entry_type = 'balance' and voided_at is not null) then raise exception 'C voided'; end if;
  exception when insufficient_privilege then null; end;
  update public.ledger_entry set amount = 1 where entry_type = 'balance';   -- RLS 로 0행
  if (select amount from public.ledger_entry where entry_type = 'balance') <> 1360000 then raise exception 'C edited amount'; end if;
  begin
    insert into public.ledger_entry (tenant_id, contract_id, entry_type, amount, received_by)
      values ((select id from public.tenant limit 1), (select id from public.contract limit 1), 'balance', 1, 'a0000000-0000-4000-8000-000000000001');
    raise exception 'C recorded payment for someone else';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.job_summary) <> 2 then raise exception 'C job_summary should show own jobs (kitchen + bath)'; end if;
end $$;

-- A: 취소 후 잔액 복원, 취소된 건 재취소 불가, 할인 조정
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.ledger_entry set voided_at = now(), void_reason = '오기재' where entry_type = 'balance';
insert into public.ledger_entry (tenant_id, contract_id, entry_type, amount, memo) values (:'t1', :'k1', 'discount', 60000, '박람회 할인');
do $$ begin
  if (select balance from public.contract_summary where contract_no = 'C26-0001') <> 1300000 then raise exception 'balance after void + discount'; end if;
  if (select voided_by from public.ledger_entry where entry_type = 'balance') <> 'a0000000-0000-4000-8000-000000000001' then raise exception 'voided_by'; end if;
  begin
    update public.ledger_entry set voided_at = now() where entry_type = 'balance';
    raise exception 're-void allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- G: 안 보임
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.ledger_entry) <> 0 then raise exception 'G sees ledger'; end if;
  if (select count(*) from public.contract_summary) <> 0 then raise exception 'G sees summary'; end if;
end $$;
reset role;
select 'RLS ledger tests passed' as result;
