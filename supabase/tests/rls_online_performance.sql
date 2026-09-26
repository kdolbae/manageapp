-- 온라인 성과(전환 결과·광고비 직접 기록) RLS 테스트. rls_contracts.sql 다음에 실행(계약 K1 을 붙인다).
\set ON_ERROR_STOP on
set role authenticated;

-- A(대표, t1): 결과 붙이기 + 계약 연결 + 단계 이름
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select id as k1 from public.contract where tenant_id = :'t1' order by created_at limit 1 \gset
insert into public.conversion_outcome (tenant_id, event_id, event_at, event_type, channel, outcome, amount, contract_id, note)
  values (:'t1', '101', '2026-09-24T05:03:22Z', 'call', 'inNaverAd', 'won', 1690000, :'k1', '카톡 상담 → 견적 발송');
insert into public.conversion_outcome (tenant_id, event_id, event_at, event_type, channel, outcome)
  values (:'t1', '102', '2026-09-24T06:00:00Z', 'kakao', 'inMeta', 'valid');
insert into public.conversion_label (tenant_id, key, name, description, sort) values (:'t1', 'won', '계약', null, 1);
insert into public.ad_spend_ledger (tenant_id, kind, day, channel, amount, note) values (:'t1', 'spend', '2026-09-24', 'inMeta', 50000, '메타 9/24');
do $$
declare t uuid := (select id from public.tenant where slug = 'nanomaster');
begin
  if (select set_by from public.conversion_outcome where event_id = '101') <> auth.uid() then raise exception 'set_by not stamped'; end if;
  -- won 이 아닌 것으로 바꾸면 금액·계약 연결이 지워진다
  update public.conversion_outcome set outcome = 'valid' where event_id = '101';
  if (select amount is not null or contract_id is not null from public.conversion_outcome where event_id = '101') then raise exception 'amount kept after leaving won'; end if;
  -- 누른 시각·채널은 바꿀 수 없다
  update public.conversion_outcome set channel = 'inGoogle', event_at = now() where event_id = '101';
  if (select channel from public.conversion_outcome where event_id = '101') <> 'inNaverAd' then raise exception 'event snapshot changed'; end if;
  -- 메모에 전화번호 거부 (금액 숫자는 통과)
  begin
    update public.conversion_outcome set note = '고객 010-1234-5678' where event_id = '102';
    raise exception 'phone in note accepted';
  exception when check_violation then null; end;
  update public.conversion_outcome set note = '견적 3500000원' where event_id = '102';
  begin
    insert into public.ad_spend_ledger (tenant_id, kind, day, channel, amount, note) values (t, 'revenue', '2026-09-24', 'inNaver', 1, '01098765432 계약');
    raise exception 'phone in ledger note accepted';
  exception when check_violation then null; end;
  -- 모르는 채널 거부
  begin
    insert into public.ad_spend_ledger (tenant_id, kind, day, channel, amount) values (t, 'spend', '2026-09-24', 'tiktok', 1);
    raise exception 'unknown channel accepted';
  exception when check_violation then null; end;
  -- 직접 기록은 고칠 수 없고 지우기만
  begin
    update public.ad_spend_ledger set amount = 1 where note = '메타 9/24';
    raise exception 'ledger amount edited';
  exception when insufficient_privilege then null; end;
  update public.ad_spend_ledger set deleted_at = now() where note = '메타 9/24';
  if (select deleted_by from public.ad_spend_ledger where note = '메타 9/24') <> auth.uid() then raise exception 'deleted_by not stamped'; end if;
  delete from public.ad_spend_ledger;
  if (select count(*) from public.ad_spend_ledger) <> 1 then raise exception 'ledger hard-deleted'; end if;
end $$;
-- 같은 계약을 두 전환에 붙이면 거부 (매출 이중 계산 방지)
update public.conversion_outcome set outcome = 'won', contract_id = :'k1' where event_id = '101';
do $$ begin
  begin
    update public.conversion_outcome set outcome = 'won', contract_id = (select contract_id from public.conversion_outcome where event_id = '101') where event_id = '102';
    raise exception 'same contract linked twice';
  exception when unique_violation then null; end;
end $$;

-- F(다른 사업체 cleanhouse 대표): t1 결과·기록 안 보이고, 자기 사업체에 t1 계약을 붙일 수 없다
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
do $$ begin
  if (select count(*) from public.conversion_outcome) <> 0 then raise exception 'F sees t1 outcomes'; end if;
  if (select count(*) from public.ad_spend_ledger) <> 0 then raise exception 'F sees t1 ledger'; end if;
  if (select count(*) from public.conversion_label) <> 0 then raise exception 'F sees t1 labels'; end if;
end $$;
reset role;
-- F 가 t1 계약을 자기 사업체 결과에 붙이려 하면 트리거가 막는다 (F 는 t1 계약을 못 보므로 id 를 직접 넣는다)
select id as k1 from public.contract where tenant_id = (select id from public.tenant where slug = 'nanomaster') order by created_at limit 1 \gset
select t.id as t2 from public.tenant t join public.membership m on m.tenant_id = t.id where m.profile_id = 'f0000000-0000-4000-8000-000000000009' limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
\set ON_ERROR_STOP off
insert into public.conversion_outcome (tenant_id, event_id, event_at, event_type, channel, outcome, contract_id)
  values (:'t2', 'x1', now(), 'call', 'inDirect', 'won', :'k1');
\set ON_ERROR_STOP on
do $$ begin
  if exists (select 1 from public.conversion_outcome where event_id = 'x1') then raise exception 'F linked t1 contract'; end if;
end $$;
\set ON_ERROR_STOP off
insert into public.ad_spend_ledger (tenant_id, kind, day, channel, amount)
  select id, 'spend', current_date, 'inMeta', 1 from public.tenant where slug = 'nanomaster';
insert into public.ad_spend_ledger (tenant_id, kind, day, channel, amount)
  values ((select tenant_id from public.contract where id = :'k1'), 'spend', current_date, 'inMeta', 1);
\set ON_ERROR_STOP on

-- C(기사): 권한 없음
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.conversion_outcome) <> 0 then raise exception 'C sees outcomes'; end if;
  delete from public.conversion_outcome;
end $$;

-- E(사무): 결과는 붙이고 지울 수 있지만 단계 이름은 못 바꾼다
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  if (select count(*) from public.conversion_outcome) <> 2 then raise exception 'E cannot read outcomes'; end if;
  delete from public.conversion_outcome where event_id = '102';
  if exists (select 1 from public.conversion_outcome where event_id = '102') then raise exception 'E cannot clear outcome'; end if;
  update public.conversion_label set name = 'x';
  if exists (select 1 from public.conversion_label where name = 'x') then raise exception 'E renamed label'; end if;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.conversion_outcome where event_id = '101') <> 1 then raise exception 'C deleted outcome'; end if;
  if exists (select 1 from public.ad_spend_ledger where tenant_id = (select id from public.tenant where slug = 'nanomaster') and deleted_at is null) then raise exception 'F wrote into t1 ledger'; end if;
end $$;
select 'RLS online performance tests passed' as result;
