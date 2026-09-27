\set ON_ERROR_STOP on
-- 현금영수증 (rls_field_signing 다음에 실행). 고객·전화번호는 모두 가짜 테스트 값.
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select id as k1 from public.contract where contract_no = 'C26-0001' and tenant_id = :'t1' \gset
select set_config('test.t1', :'t1', false);
select set_config('test.k1', :'k1', false);

-- 1) 서버(service_role): 남은 금액 = 취소 안 된 현금·이체 수납(계좌이체 계약금 500,000)
set role service_role;
do $$ begin
  if public.cash_receipt_unissued(current_setting('test.k1')::uuid) <> 500000 then
    raise exception 'unissued %', public.cash_receipt_unissued(current_setting('test.k1')::uuid);
  end if;
end $$;

insert into public.cash_receipt_request (tenant_id, conversation_id, message_id, raw_text)
  values (:'t1', '19:test@thread.v2', 'm1', '테스트 요청') returning id as rq \gset
do $$ begin
  begin
    insert into public.cash_receipt_request (tenant_id, conversation_id, message_id, raw_text)
      values (current_setting('test.t1')::uuid, '19:test@thread.v2', 'm1', '같은 메시지');
    raise exception 'duplicate message accepted';
  exception when unique_violation then null; end;
end $$;

select (public.reserve_cash_receipt(jsonb_build_object('tenant_id', :'t1', 'contract_id', :'k1', 'request_id', :'rq',
  'identity_num', '010-1234-5678', 'customer_name', '김서연', 'item_name', '줄눈 시공', 'provider', 'mock'))).id as r1 \gset
select set_config('test.r1', :'r1', false);
do $$ declare r public.cash_receipt; begin
  select * into r from public.cash_receipt where id = current_setting('test.r1')::uuid;
  if r.status <> 'pending' or r.total_amount <> 500000 or r.supply_cost <> 454545 or r.tax <> 45455 then raise exception 'reserve amounts %', row_to_json(r); end if;
  if r.identity_num <> '01012345678' or r.mgt_key !~ '^JD[0-9]{6}-[0-9A-F]{12}$' or length(r.image_token) <> 36 then raise exception 'reserve fields %', row_to_json(r); end if;
  -- 발행 중이면 두 번째 예약 불가 (이중 발행 차단)
  begin
    perform public.reserve_cash_receipt(jsonb_build_object('tenant_id', current_setting('test.t1'), 'contract_id', current_setting('test.k1'), 'identity_num', '01012345678', 'provider', 'mock'));
    raise exception 'second reserve while pending';
  exception when sqlstate 'P0003' then null; end;
  -- 실패로 끝나면 금액이 풀린다
  update public.cash_receipt set status = 'failed', error_message = 'test' where id = r.id;
  if public.cash_receipt_unissued(r.contract_id) <> 500000 then raise exception 'failed receipt still reserved'; end if;
  -- 금액은 고칠 수 없고, 실패 → 발행 같은 상태 변경도 막힌다
  begin
    update public.cash_receipt set total_amount = 1, supply_cost = 1, tax = 0 where id = r.id;
    raise exception 'amount edited';
  exception when insufficient_privilege then null; end;
  begin
    update public.cash_receipt set status = 'issued' where id = r.id;
    raise exception 'failed -> issued allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- 다시 예약 → 발행 완료 → 남은 금액 0 → 또 요청하면 발행할 것 없음
select (public.reserve_cash_receipt(jsonb_build_object('tenant_id', :'t1', 'contract_id', :'k1', 'identity_num', '01012345678', 'provider', 'mock', 'amount', 300000))).id as r2 \gset
select set_config('test.r2', :'r2', false);
do $$ begin
  if public.cash_receipt_unissued(current_setting('test.k1')::uuid) <> 200000 then raise exception 'partial reserve'; end if;
  update public.cash_receipt set status = 'issued', confirm_num = 'TEST00001', trade_date = '20261010' where id = current_setting('test.r2')::uuid;
  if (select issued_at from public.cash_receipt where id = current_setting('test.r2')::uuid) is null then raise exception 'issued_at not set'; end if;
  begin
    perform public.reserve_cash_receipt(jsonb_build_object('tenant_id', current_setting('test.t1'), 'contract_id', current_setting('test.k1'), 'identity_num', '01012345678', 'provider', 'mock', 'amount', 200001));
    raise exception 'over-issue allowed';
  exception when sqlstate 'P0005' then null; end;
  -- 다른 사업체 id 로는 계약을 못 찾는다
  begin
    perform public.reserve_cash_receipt(jsonb_build_object('tenant_id', (select id from public.tenant where slug = 'cleanhouse'), 'contract_id', current_setting('test.k1'), 'identity_num', '01012345678', 'provider', 'mock'));
    raise exception 'cross-tenant reserve';
  exception when sqlstate 'P0002' then null; end;
end $$;
select (public.reserve_cash_receipt(jsonb_build_object('tenant_id', :'t1', 'contract_id', :'k1', 'identity_num', '01012345678', 'provider', 'mock'))).id as r3 \gset
update public.cash_receipt set status = 'issued', confirm_num = 'TEST00002' where id = :'r3';
do $$ begin
  begin
    perform public.reserve_cash_receipt(jsonb_build_object('tenant_id', current_setting('test.t1'), 'contract_id', current_setting('test.k1'), 'identity_num', '01012345678', 'provider', 'mock'));
    raise exception 'issued twice';
  exception when sqlstate 'P0004' then null; end;
end $$;
-- 카드 수납·영수증 번호가 이미 적힌 수납은 대상이 아니다. 새 현금 수납만 늘어난다.
reset role;
insert into public.ledger_entry (tenant_id, contract_id, entry_type, amount, pay_method_code) values (:'t1', :'k1', 'interim', 100000, 'card');
insert into public.ledger_entry (tenant_id, contract_id, entry_type, amount, pay_method_code, receipt_no) values (:'t1', :'k1', 'interim', 70000, 'cash', '수기발행');
insert into public.ledger_entry (tenant_id, contract_id, entry_type, amount, pay_method_code) values (:'t1', :'k1', 'interim', 50000, 'cash');
do $$ begin
  if public.cash_receipt_unissued(current_setting('test.k1')::uuid) <> 50000 then
    raise exception 'unissued after new payments %', public.cash_receipt_unissued(current_setting('test.k1')::uuid);
  end if;
end $$;

-- 2) 채팅방 연결 코드: 맞는 코드면 연결되고 코드는 사라진다. 만료·틀린 코드는 null.
insert into public.integration_config (tenant_id, kind, config)
  values (:'t1', 'teams_bot', jsonb_build_object('link_code', 'AB12CD34', 'link_code_expires_at', now() + interval '30 minutes'));
set role service_role;
do $$ declare tid uuid; begin
  if public.link_teams_conversation('zz999999', '{"conversation_id": "19:x", "service_url": "https://smba.example/"}') is not null then raise exception 'wrong code linked'; end if;
  tid := public.link_teams_conversation(' ab12cd34 ', '{"conversation_id": "19:test@thread.v2", "service_url": "https://smba.example/", "title": "현영 요청방"}');
  if tid is distinct from current_setting('test.t1')::uuid then raise exception 'link failed'; end if;
  if public.link_teams_conversation('AB12CD34', '{"conversation_id": "19:other", "service_url": "https://smba.example/"}') is not null then raise exception 'code reused'; end if;
end $$;
reset role;
update public.integration_config set config = jsonb_build_object('link_code', 'EXPIRED1', 'link_code_expires_at', now() - interval '1 minute') where tenant_id = :'t1' and kind = 'teams_bot';
set role service_role;
do $$ begin
  if public.link_teams_conversation('EXPIRED1', '{"conversation_id": "19:y", "service_url": "https://smba.example/"}') is not null then raise exception 'expired code linked'; end if;
end $$;

-- 3) 사용자: 대표 A 는 발행 기록·요청·채팅방을 보고, 직접 발행(예약)·기록은 못 한다
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.cash_receipt) <> 3 then raise exception 'A receipts %', (select count(*) from public.cash_receipt); end if;
  if (select count(*) from public.cash_receipt_request) <> 1 then raise exception 'A requests'; end if;
  if (select count(*) from public.teams_conversation) <> 1 then raise exception 'A conversations'; end if;
  begin
    perform public.reserve_cash_receipt(jsonb_build_object('tenant_id', current_setting('test.t1'), 'contract_id', current_setting('test.k1'), 'identity_num', '01012345678', 'provider', 'mock'));
    raise exception 'A reserved directly';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.cash_receipt (tenant_id, contract_id, provider, mgt_key, identity_num, item_name, total_amount, supply_cost, tax)
      values (current_setting('test.t1')::uuid, current_setting('test.k1')::uuid, 'mock', 'X', '01000000000', 'x', 1, 1, 0);
    raise exception 'A inserted receipt';
  exception when insufficient_privilege then null; end;
  begin
    perform public.link_teams_conversation('AB12CD34', '{}');
    raise exception 'A linked conversation';
  exception when insufficient_privilege then null; end;
end $$;
-- 다른 사업체 사람 G 는 아무것도 못 본다
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.cash_receipt) + (select count(*) from public.cash_receipt_request) + (select count(*) from public.teams_conversation) <> 0 then
    raise exception 'G sees cash receipts';
  end if;
end $$;
-- 익명은 함수를 부를 수 없다
set role anon;
do $$ begin
  begin
    perform public.cash_receipt_unissued(current_setting('test.k1')::uuid);
    raise exception 'anon called unissued';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'RLS cash_receipt tests passed' as result;
