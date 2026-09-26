\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
-- 연동 설정: 홈페이지 키 + Teams 웹훅
insert into public.integration_config (tenant_id, kind, config) values
  (:'t1', 'web_inquiry', '{"key_hash":"abc123"}'),
  (:'t1', 'teams_webhook', '{"url":"https://example.invalid/webhook"}');
reset role;
-- 서비스 키 경로로 문의 인입 (같은 external_id 두 번이면 한 번만)
set role service_role;
select public.ingest_web_inquiry('abc123', '{"name":"박지훈","phone":"010-2222-3333","kind":"견적","message":"주방 상판 코팅 견적 문의","apt":"아크로리버파크","source_page":"/kitchen","utm":{"utm_source":"naver"},"external_id":"web-1"}') as i1 \gset
select public.ingest_web_inquiry('abc123', '{"name":"박지훈","external_id":"web-1"}');
do $$ begin
  begin
    perform public.ingest_web_inquiry('wrong', '{"name":"x"}');
    raise exception 'bad key accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.inquiry) <> 1 then raise exception 'inquiry dedupe failed'; end if;
  if (select phone from public.inquiry) <> '01022223333' then raise exception 'inquiry phone norm'; end if;
  if (select count(*) from public.inapp_notification where profile_id = auth.uid() and kind = 'inquiry.new') <> 1 then raise exception 'A should get inapp notification'; end if;
  if (select count(*) from public.notification_outbox where channel = 'teams' and status = 'pending') <> 1 then raise exception 'teams outbox row missing'; end if;
end $$;
-- 상담 기록 → 상태 자동 전환 + 첫 응답 시각
insert into public.consultation (tenant_id, inquiry_id, channel, direction, summary) values (:'t1', :'i1', 'call', 'out', '통화, 견적 안내');
do $$ begin
  if (select status from public.inquiry) <> 'contacted' then raise exception 'status not contacted'; end if;
  if (select first_response_at from public.inquiry) is null then raise exception 'first_response_at'; end if;
  if (select count(*) from public.status_history where entity = 'inquiry') <> 1 then raise exception 'inquiry history'; end if;
end $$;
-- C(기사): 문의 권한 없음 → 안 보임. 알림도 없음
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.inquiry) <> 0 then raise exception 'C sees inquiries'; end if;
  if (select count(*) from public.inapp_notification) <> 0 then raise exception 'C got inquiry notification'; end if;
  if (select count(*) from public.integration_config) <> 0 then raise exception 'C sees integration config'; end if;
end $$;
-- E(사무): 보이고, 읽음 처리는 본인 알림만
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  if (select count(*) from public.inquiry) <> 1 then raise exception 'E should see inquiry'; end if;
  if (select count(*) from public.inapp_notification) <> 1 then raise exception 'E should have 1 notification'; end if;
  update public.inapp_notification set read_at = now();
  if (select count(*) from public.inapp_notification where read_at is null) <> 0 then raise exception 'E read failed'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.inapp_notification where read_at is null) <> 1 then raise exception 'E touched A notification'; end if;
end $$;
reset role;
select 'RLS inquiry tests passed' as result;
