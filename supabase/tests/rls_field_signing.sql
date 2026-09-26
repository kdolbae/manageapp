\set ON_ERROR_STOP on
-- D14: 시공기사 현장 계약 등록 + 고객 전자서명 (rls_platform / rls_app_link 다음에 실행)

-- 1) 시공기사 C(own): 고객·계약 등록 가능, 담당은 본인만
set role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select set_config('test.t1', :'t1', false);
insert into public.customer (tenant_id, name, phone, owner_id)
  values (:'t1', '현장고객', '010-7777-8888', 'c0000000-0000-4000-8000-000000000003') returning id as fc \gset
select set_config('test.fc', :'fc', false);
do $$ begin
  begin
    insert into public.customer (tenant_id, name, owner_id) values (current_setting('test.t1')::uuid, '남의고객', 'a0000000-0000-4000-8000-000000000001');
    raise exception 'C created customer owned by A';
  exception when insufficient_privilege then null; end;
end $$;
select public.create_contract(jsonb_build_object(
  'tenant_id', :'t1', 'customer_id', :'fc', 'sales_owner_id', 'c0000000-0000-4000-8000-000000000003', 'intake_type_code', 'fair',
  'lines', jsonb_build_array(jsonb_build_object('name', '욕실 줄눈', 'work_area_code', 'bath', 'qty', 1, 'unit_price', 500000)),
  'jobs', jsonb_build_array(jsonb_build_object('work_area_code', 'bath', 'scheduled_date', '2026-10-20')))) as fk \gset
select set_config('test.fk', :'fk', false);
do $$ begin
  if (select count(*) from public.contract where id = current_setting('test.fk')::uuid) <> 1 then raise exception 'C cannot see own contract'; end if;
  if (select count(*) from public.job where contract_id = current_setting('test.fk')::uuid) <> 1 then raise exception 'C cannot see job of own contract'; end if;
  if (select count(*) from public.job_line jl join public.job j on j.id = jl.job_id where j.contract_id = current_setting('test.fk')::uuid) <> 1 then raise exception 'job_line missing'; end if;
  if (select status from public.contract_summary where id = current_setting('test.fk')::uuid) <> 'pending_approval' then raise exception 'own contract status'; end if;
  begin
    perform public.create_contract(jsonb_build_object('tenant_id', current_setting('test.t1'), 'customer_id', current_setting('test.fc'),
      'sales_owner_id', 'a0000000-0000-4000-8000-000000000001', 'lines', jsonb_build_array(jsonb_build_object('name', 'x', 'unit_price', 1))));
    raise exception 'C created contract for another owner';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_contract(jsonb_build_object('tenant_id', current_setting('test.t1'), 'customer_id', current_setting('test.fc'),
      'sales_owner_id', 'c0000000-0000-4000-8000-000000000003', 'lines', jsonb_build_array(jsonb_build_object('name', 'x', 'unit_price', 1)),
      'jobs', jsonb_build_array(jsonb_build_object('work_area_code', 'bath', 'technician_id', (select id from public.technician where name = 'C 기사')))));
    raise exception 'C assigned a technician without job.assign';
  exception when insufficient_privilege then null; end;
end $$;

-- 2) 현장 기기 서명 (C, 본인 계약)
insert into public.contract_signature (tenant_id, contract_id, signer_name, signature_data, consents)
  values (:'t1', :'fk', ' 현장고객 ', 'data:image/png;base64,' || repeat('A', 400), '{"terms": true, "privacy": true, "marketing": true}') returning id as sg1 \gset
select set_config('test.sg1', :'sg1', false);
do $$ declare s public.contract_signature; n int; info jsonb; begin
  select * into s from public.contract_signature where id = current_setting('test.sg1')::uuid;
  if s.method <> 'device' or s.witnessed_by <> auth.uid() or s.signer_name <> '현장고객' then raise exception 'device signature meta'; end if;
  if s.terms_text not like '제1조%' or length(s.material_hash) <> 64 or length(s.record_hash) <> 64 then raise exception 'snapshot/hash missing'; end if;
  if (s.snapshot->>'sale_total')::numeric <> 500000 or jsonb_array_length(s.snapshot->'lines') <> 1 or s.snapshot->'customer'->>'name' <> '현장고객' then raise exception 'snapshot content %', s.snapshot; end if;
  if (select signed_at from public.contract where id = s.contract_id) is null then raise exception 'contract.signed_at not set'; end if;
  if (select marketing_consent from public.customer where id = current_setting('test.fc')::uuid) is not true then raise exception 'marketing consent not applied'; end if;
  if (select count(*) from public.status_history where entity = 'contract' and entity_id = s.contract_id and to_status = 'signed') <> 1 then raise exception 'no signed history'; end if;
  -- 필수 동의 없으면 거부
  begin
    insert into public.contract_signature (tenant_id, contract_id, signer_name, signature_data, consents)
      values (s.tenant_id, s.contract_id, 'x', 'data:image/png;base64,' || repeat('A', 400), '{"terms": true}');
    raise exception 'signed without privacy consent';
  exception when invalid_parameter_value then null; end;
  -- 서명 기록은 고치거나 지울 수 없다 (정책 없음 → 0행)
  update public.contract_signature set signer_name = '변조' where id = s.id; get diagnostics n = row_count;
  if n > 0 then raise exception 'signature edited'; end if;
  delete from public.contract_signature where id = s.id; get diagnostics n = row_count;
  if n > 0 then raise exception 'signature deleted'; end if;
  -- 서명 화면 자료: 현재 해시 = 서명 해시
  info := public.contract_signing_info(s.contract_id);
  if info->>'material_hash' <> s.material_hash then raise exception 'material hash mismatch right after signing'; end if;
  if info->'signature'->>'id' <> s.id::text or info->>'terms' not like '제1조%' then raise exception 'signing info'; end if;
end $$;

-- C 는 배정된 계약(C26-0001, 영업 담당 A)에도 서명을 받을 수 있다. 안 보이는 계약(APP-1)은 안 된다
select id as k1 from public.contract where contract_no = 'C26-0001' \gset
select set_config('test.k1', :'k1', false);
reset role;
select id as app1 from public.contract where contract_no = 'APP-1' \gset
select set_config('test.app1', :'app1', false);
set role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  insert into public.contract_signature (tenant_id, contract_id, signer_name, signature_data, consents)
    values (current_setting('test.t1')::uuid, current_setting('test.k1')::uuid, '김서연', 'data:image/png;base64,' || repeat('C', 400), '{"terms": true, "privacy": true}');
  if public.contract_signing_info(current_setting('test.app1')::uuid) is not null then raise exception 'C sees signing info of invisible contract'; end if;
  begin
    insert into public.contract_signature (tenant_id, contract_id, signer_name, signature_data, consents)
      values (current_setting('test.t1')::uuid, current_setting('test.app1')::uuid, 'x', 'data:image/png;base64,' || repeat('C', 400), '{"terms": true, "privacy": true}');
    raise exception 'C signed invisible contract';
  exception when insufficient_privilege then null; end;
end $$;

-- 3) 계약 내용이 바뀌면 다시 서명 필요 (A 가 품목 금액 변경)
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.contract_line set unit_price = 450000 where contract_id = :'fk';
do $$ declare info jsonb; begin
  info := public.contract_signing_info(current_setting('test.fk')::uuid);
  if info->>'material_hash' = info->'signature'->>'material_hash' then raise exception 'hash should change after price edit'; end if;
end $$;
-- 일정 변경은 서명 효력에 영향 없음
update public.job set scheduled_date = '2026-10-22' where contract_id = :'fk';
do $$ declare info jsonb; s public.contract_signature; begin
  info := public.contract_signing_info(current_setting('test.fk')::uuid);
  update public.contract_line set unit_price = 500000 where contract_id = current_setting('test.fk')::uuid;
  info := public.contract_signing_info(current_setting('test.fk')::uuid);
  if info->>'material_hash' <> info->'signature'->>'material_hash' then raise exception 'schedule change should not break hash'; end if;
end $$;

-- 4) 다른 사업체(G)는 아무것도 못 본다. 사무 E 는 본다
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.contract_signature) <> 0 then raise exception 'G sees signatures'; end if;
  if public.contract_signing_info(current_setting('test.fk')::uuid) is not null then raise exception 'G sees signing info'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  if (select count(*) from public.contract_signature) <> 2 then raise exception 'E should see 2 signatures, saw %', (select count(*) from public.contract_signature); end if;
end $$;

-- 5) 고객 링크 서명 (서비스 키): 뒷 4자리 확인, 방식 link, 담당자 알림
reset role;
select public_token as tok2 from public.contract where id = :'fk' \gset
select set_config('test.tok2', :'tok2', false);
set role anon;
do $$ begin
  begin
    perform public.customer_signing('nanomaster', current_setting('test.tok2'));
    raise exception 'anon called customer_signing';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
select set_config('request.jwt.claim.sub', '', false);
do $$ declare d jsonb; sid uuid; begin
  d := public.customer_signing('nanomaster', current_setting('test.tok2'));
  if d is null or (d->>'can_sign')::boolean is not true or (d->>'phone_check')::boolean is not true then raise exception 'customer_signing %', d; end if;
  if d->'signature'->>'method' <> 'device' then raise exception 'latest should be device'; end if;
  begin
    perform public.customer_sign_contract('nanomaster', current_setting('test.tok2'), '현장고객', '0000', 'data:image/png;base64,' || repeat('B', 400), '{"terms":true,"privacy":true}', '1.2.3.4', 'ua');
    raise exception 'wrong phone tail accepted';
  exception when invalid_parameter_value then null; end;
  sid := public.customer_sign_contract('nanomaster', current_setting('test.tok2'), '현장고객', '8888', 'data:image/png;base64,' || repeat('B', 400), '{"terms":true,"privacy":true}', '1.2.3.4', 'ua');
  if (select method from public.contract_signature where id = sid) <> 'link' then raise exception 'link method'; end if;
  if (select witnessed_by from public.contract_signature where id = sid) is not null then raise exception 'link should have no witness'; end if;
  if (select ip from public.contract_signature where id = sid) <> '1.2.3.4' then raise exception 'ip not stored'; end if;
  d := public.customer_signing('nanomaster', current_setting('test.tok2'));
  if d->'signature'->>'method' <> 'link' then raise exception 'latest should be link'; end if;
  if (d->'signature'->>'signer_name') not like '%*%' then raise exception 'signer name not masked'; end if;
  if (d->'signature'->>'changed')::boolean then raise exception 'changed should be false'; end if;
  if (select count(*) from public.inapp_notification where kind = 'contract.signed' and profile_id = 'c0000000-0000-4000-8000-000000000003') <> 1 then raise exception 'sales owner not notified'; end if;
  begin
    perform public.customer_sign_contract('nanomaster', 'ffffffffffffffffffffffff', 'x', '8888', 'data:image/png;base64,' || repeat('B', 400), '{"terms":true,"privacy":true}', null, null);
    raise exception 'wrong token accepted';
  exception when insufficient_privilege then null; end;
  if public.customer_signing('mjcon', current_setting('test.tok2')) is not null then raise exception 'wrong slug accepted'; end if;
end $$;
reset role;

-- 6) 약관 문구는 사업체 설정으로 바꾼다. 바꾼 뒤 서명에는 새 문구가 남는다
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.tenant set settings = settings || '{"contract_terms": "약관 X"}'::jsonb where id = :'t1';
do $$ declare info jsonb; begin
  info := public.contract_signing_info(current_setting('test.fk')::uuid);
  if info->>'terms' <> '약관 X' then raise exception 'terms override not applied'; end if;
  insert into public.contract_signature (tenant_id, contract_id, signer_name, signature_data, consents)
    values (current_setting('test.t1')::uuid, current_setting('test.fk')::uuid, '현장고객', 'data:image/png;base64,' || repeat('D', 400), '{"terms": true, "privacy": true}');
  if (select terms_text from public.contract_signature where contract_id = current_setting('test.fk')::uuid order by signed_at desc limit 1) <> '약관 X' then raise exception 'new terms not snapshotted'; end if;
  if (select count(*) from public.contract_signature where contract_id = current_setting('test.fk')::uuid) <> 3 then raise exception 'signature count'; end if;
end $$;
-- 취소된 계약에는 서명 불가
update public.contract set canceled_at = now(), cancel_reason = '테스트' where id = :'fk';
do $$ begin
  begin
    insert into public.contract_signature (tenant_id, contract_id, signer_name, signature_data, consents)
      values (current_setting('test.t1')::uuid, current_setting('test.fk')::uuid, '현장고객', 'data:image/png;base64,' || repeat('E', 400), '{"terms": true, "privacy": true}');
    raise exception 'signed canceled contract';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
select 'RLS field signing tests passed' as result;
