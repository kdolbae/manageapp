\set ON_ERROR_STOP on
-- 집대리 플랫폼 층: 운영사 지정, 협력업체 신청·승인, 요청·견적·대화(연락처 비노출), 수수료·정산, 광고
-- 운영사: A 가 '집대리' 사업체를 만들고 운영사로 지정. B 는 못 한다
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select public.create_tenant('집대리', 'jipdaeri') as tp \gset
select set_config('test.tp', :'tp', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select set_config('test.t1', :'t1', false);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', false);
do $$ begin
  begin
    perform public.claim_platform_operator(current_setting('test.tp')::uuid);
    raise exception 'B claimed operator';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select public.claim_platform_operator(:'tp');
do $$ begin
  if not app.is_platform_admin() then raise exception 'A should be platform admin'; end if;
end $$;
-- 신청 (서비스 키) → 운영자 알림
reset role;
set role service_role;
select set_config('request.jwt.claim.sub', '', false);   -- 서비스 키에는 sub 가 없다
select public.vendor_apply('{"name":"클린하우스","phone":"010-7777-8888","email":"v@test.local","regions":["대구"],"categories":["cleaning","coating"],"intro":"입주청소 10년"}') as app1 \gset
reset role;
select set_config('test.app1', :'app1', false);
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.vendor_application) <> 1 then raise exception 'A should see application'; end if;
  if (select count(*) from public.inapp_notification where kind = 'vendor.applied' and profile_id = auth.uid()) <> 1 then raise exception 'A not notified of application'; end if;
end $$;
-- B 는 신청을 못 보고 승인도 못 한다
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', false);
do $$ begin
  if (select count(*) from public.vendor_application) <> 0 then raise exception 'B sees applications'; end if;
  begin
    perform public.approve_vendor(current_setting('test.app1')::uuid, 'cleanhouse');
    raise exception 'B approved vendor';
  exception when insufficient_privilege then null; end;
end $$;
-- A 승인 → 사업체·업체 소개·대표 초대 생성. A 는 그 업체 구성원이 아니다
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select public.approve_vendor(:'app1', 'cleanhouse') as approved \gset
select (:'approved'::jsonb)->>'tenant_id' as tv \gset
select (:'approved'::jsonb)->>'invitation_token' as vtok \gset
select set_config('test.tv', :'tv', false);
do $$ begin
  if (select status from public.vendor_application) <> 'approved' then raise exception 'application not approved'; end if;
  if (select count(*) from public.vendor_profile where tenant_id = current_setting('test.tv')::uuid) <> 1 then raise exception 'vendor profile missing'; end if;
  if (select is_listed from public.vendor_profile where tenant_id = current_setting('test.tv')::uuid) then raise exception 'listed too early'; end if;
  if exists (select 1 from public.membership where tenant_id = current_setting('test.tv')::uuid) then raise exception 'A became member of vendor tenant'; end if;
end $$;
-- V 가입 후 초대 수락 → 대표. 운영자는 아니다
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('f0000000-0000-4000-8000-000000000009', 'v@test.local', '{"display_name":"V 사장"}');
set role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
select public.accept_invitation(:'vtok');
do $$ begin
  if not app.is_owner(current_setting('test.tv')::uuid) then raise exception 'V not owner'; end if;
  if app.is_platform_admin() then raise exception 'V should not be platform admin'; end if;
end $$;
-- V: 업체 소개 편집 가능, 노출은 못 켠다
update public.vendor_profile set intro = '입주청소·코팅 전문', regions = array['대구','경북'] where tenant_id = :'tv';
do $$ begin
  if (select intro from public.vendor_profile where tenant_id = current_setting('test.tv')::uuid) <> '입주청소·코팅 전문' then raise exception 'V edit failed'; end if;
  begin
    update public.vendor_profile set is_listed = true where tenant_id = current_setting('test.tv')::uuid;
    raise exception 'V listed itself';
  exception when insufficient_privilege then null; end;
end $$;
-- A(운영자) 노출 켬. 나노마스터(t1)도 업체 소개를 만들어 노출
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.vendor_profile set is_listed = true where tenant_id = :'tv';
insert into public.vendor_profile (tenant_id, categories, regions, intro, is_listed) values (:'t1', array['coating','grout'], array['대구'], '나노코팅 전문', true);
do $$ begin
  if (select count(*) from public.vendor_card) <> 2 then raise exception 'vendor_card count'; end if;
  if (select listed_at from public.vendor_profile where tenant_id = current_setting('test.tv')::uuid) is null then raise exception 'listed_at'; end if;
end $$;
-- 고객 요청 (서비스 키): 코팅, 대구 수성구 → 두 업체 모두에게 알림
reset role;
set role service_role;
select set_config('request.jwt.claim.sub', '', false);   -- 서비스 키에는 sub 가 없다
select public.request_create('{"name":"김서연","phone":"010-1234-5678","region":"대구 수성구","apt":"힐스테이트","area_pyeong":34,"categories":["coating"],"message":"주방·욕실 코팅 견적 부탁드려요","move_in_date":"2026-10-20"}') as req \gset
reset role;
select (:'req'::jsonb)->>'id' as rid \gset
select (:'req'::jsonb)->>'token' as rtok \gset
select set_config('test.rid', :'rid', false);
select set_config('test.rtok', :'rtok', false);
set role authenticated;
-- E(t1 사무, market.read): 이름 가림, 연락처 없음, 원본 테이블은 못 읽는다
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ declare r record; begin
  select * into r from public.market_request where id = current_setting('test.rid')::uuid;
  if r.id is null then raise exception 'E should see request'; end if;
  if r.name_masked not like '%*%' then raise exception 'name not masked'; end if;
  if r.contact_phone is not null or r.contact_name is not null then raise exception 'contact leaked before accept'; end if;
  if (select count(*) from public.inapp_notification where kind = 'request.new' and profile_id = auth.uid()) <> 1 then raise exception 'E not notified'; end if;
  if (select count(*) from public.service_request) <> 0 then raise exception 'E reads raw request'; end if;
end $$;
-- 운영자용 업체 목록: A 는 2곳(이름 포함) 본다, V 는 0
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.platform_vendor) <> 2 then raise exception 'platform_vendor count'; end if;
  if (select name from public.platform_vendor where tenant_id = current_setting('test.tv')::uuid) <> '클린하우스' then raise exception 'platform_vendor name'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
do $$ begin
  if (select count(*) from public.platform_vendor) <> 0 then raise exception 'V sees platform_vendor'; end if;
end $$;
-- G(mjcon 만, 업체 소개 없음): 안 보이고 견적도 못 낸다 (B 는 나노마스터 사무 겸직이라 보인다)
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
select id as t2 from public.tenant where slug = 'mjcon' \gset
select set_config('test.t2', :'t2', false);
do $$ begin
  if (select count(*) from public.market_request) <> 0 then raise exception 'G sees request'; end if;
  begin
    insert into public.quote (request_id, tenant_id, amount) values (current_setting('test.rid')::uuid, current_setting('test.t2')::uuid, 100000);
    raise exception 'G quoted';
  exception when insufficient_privilege then null; end;
end $$;
-- V 견적 300,000 / E(t1) 견적 280,000
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
insert into public.quote (request_id, tenant_id, amount, items, message) values (:'rid', :'tv', 300000, '[{"name":"주방 코팅","qty":1,"unit_price":180000},{"name":"욕실 코팅","qty":1,"unit_price":120000}]', '10/21 가능합니다') returning id as qv \gset
select set_config('test.qv', :'qv', false);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
insert into public.quote (request_id, tenant_id, amount, message) values (:'rid', :'t1', 280000, '나노코팅 전문') returning id as q1 \gset
select set_config('test.q1', :'q1', false);
-- V 는 남의 견적을 못 보고, 자기 견적을 채택하지 못한다
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
do $$ begin
  if (select count(*) from public.quote) <> 1 then raise exception 'V sees other quotes'; end if;
  begin
    update public.quote set status = 'accepted' where id = current_setting('test.qv')::uuid;
    raise exception 'V accepted own quote';
  exception when insufficient_privilege then null; end;
end $$;
-- 고객: 두 견적 비교 → V 선택. 틀린 토큰은 null
reset role;
set role service_role;
select set_config('request.jwt.claim.sub', '', false);   -- 서비스 키에는 sub 가 없다
do $$ declare d jsonb; begin
  d := public.request_page(current_setting('test.rtok'));
  if jsonb_array_length(d->'quotes') <> 2 then raise exception 'customer should see 2 quotes'; end if;
  if (d->'quotes'->0->'vendor'->>'name') is null then raise exception 'vendor card missing'; end if;
  if public.request_page('ffffffffffffffffffffffffffffffff') is not null then raise exception 'wrong token accepted'; end if;
end $$;
select public.request_accept(:'rtok', :'qv');
do $$ begin
  if (select status from public.quote where id = current_setting('test.qv')::uuid) <> 'accepted' then raise exception 'quote not accepted'; end if;
  if (select status from public.quote where id = current_setting('test.q1')::uuid) <> 'declined' then raise exception 'other quote not declined'; end if;
  if (select status from public.service_request where id = current_setting('test.rid')::uuid) <> 'accepted' then raise exception 'request not accepted'; end if;
  begin
    perform public.request_accept(current_setting('test.rtok'), current_setting('test.q1')::uuid);
    raise exception 'accepted twice';
  exception when insufficient_privilege then null; end;
end $$;
-- 고객이 V 에게 메시지. 견적 안 낸 업체에게는 못 보낸다
select public.request_customer_message(:'rtok', :'tv', '10/21 오전 가능할까요?');
do $$ begin
  begin
    perform public.request_customer_message(current_setting('test.rtok'), current_setting('test.t2')::uuid, 'x');
    raise exception 'message to non-quoting vendor';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
-- V: 채택·메시지 알림, 이름·주소는 보이고 전화는 아직 안 보임, 답장
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
do $$ declare r record; begin
  if (select count(*) from public.inapp_notification where kind = 'quote.accepted' and profile_id = auth.uid()) <> 1 then raise exception 'V not notified of accept'; end if;
  if (select count(*) from public.inapp_notification where kind = 'message.new' and profile_id = auth.uid()) <> 1 then raise exception 'V not notified of message'; end if;
  select * into r from public.market_request where id = current_setting('test.rid')::uuid;
  if r.contact_name <> '김서연' then raise exception 'accepted vendor should see name'; end if;
  if r.contact_address is null then raise exception 'accepted vendor should see address'; end if;
  if r.contact_phone is not null then raise exception 'phone shown before consent'; end if;
  if (select count(*) from public.request_message) <> 1 then raise exception 'V should see 1 message'; end if;
end $$;
insert into public.request_message (request_id, tenant_id, sender, sender_id, body) values (:'rid', :'tv', 'vendor', auth.uid(), '네, 오전 9시 가능합니다');
-- E(t1): 탈락 업체는 요청은 보되 연락처·남의 대화는 못 본다
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ declare r record; begin
  select * into r from public.market_request where id = current_setting('test.rid')::uuid;
  if r.id is null then raise exception 'E should still see request (quoted)'; end if;
  if r.contact_name is not null or r.contact_phone is not null then raise exception 'declined vendor sees contact'; end if;
  if (select count(*) from public.request_message) <> 0 then raise exception 'E sees V thread'; end if;
  begin
    insert into public.request_message (request_id, tenant_id, sender, sender_id, body) values (current_setting('test.rid')::uuid, current_setting('test.tv')::uuid, 'vendor', auth.uid(), 'x');
    raise exception 'E wrote into V thread';
  exception when insufficient_privilege then null; end;
end $$;
-- 고객이 전화 공개 → V 만 본다
reset role;
set role service_role;
select set_config('request.jwt.claim.sub', '', false);   -- 서비스 키에는 sub 가 없다
select public.request_share_phone(:'rtok', true);
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
do $$ begin
  if (select contact_phone from public.market_request where id = current_setting('test.rid')::uuid) <> '01012345678' then raise exception 'V should see phone after consent'; end if;
end $$;
-- V: 견적 → 계약 전환 (자기 사업체에 고객·현장·계약 생성, 두 번 불러도 같은 계약)
select public.convert_quote_to_contract(:'qv') as cv \gset
select set_config('test.cv', :'cv', false);
do $$ begin
  if (select sale_total from public.contract_summary where id = current_setting('test.cv')::uuid) <> 300000 then raise exception 'contract total'; end if;
  if (select platform_quote_id from public.contract where id = current_setting('test.cv')::uuid) <> current_setting('test.qv')::uuid then raise exception 'platform_quote_id'; end if;
  if (select phone from public.customer where tenant_id = current_setting('test.tv')::uuid) <> '01012345678' then raise exception 'customer phone'; end if;
  if (select intake_type_code from public.contract where id = current_setting('test.cv')::uuid) <> 'platform' then raise exception 'intake'; end if;
  if public.convert_quote_to_contract(current_setting('test.qv')::uuid) <> current_setting('test.cv')::uuid then raise exception 'convert not idempotent'; end if;
end $$;
-- E(t1) 는 탈락 견적을 전환 못 한다
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  begin
    perform public.convert_quote_to_contract(current_setting('test.q1')::uuid);
    raise exception 'declined quote converted';
  exception when insufficient_privilege then null; end;
end $$;
-- 수수료·정산: A 가 V 업체 10% 설정 → 이번 달 정산서 = 30,000
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.platform_fee set fee_type = 'percent', rate = 10 where tenant_id = :'tv';
select public.build_platform_settlement(:'tv', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date) as s1 \gset
select set_config('test.s1', :'s1', false);
do $$ begin
  if (select total from public.platform_settlement where id = current_setting('test.s1')::uuid) <> 30000 then raise exception 'settlement total %', (select total from public.platform_settlement where id = current_setting('test.s1')::uuid); end if;
  if (select count(*) from public.platform_settlement_line where settlement_id = current_setting('test.s1')::uuid) <> 1 then raise exception 'settlement lines'; end if;
end $$;
-- V: 자기 정산서·수수료는 보되 발행은 못 한다. G 는 아무것도 못 본다
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
do $$ begin
  if (select count(*) from public.platform_settlement) <> 1 then raise exception 'V should see own settlement'; end if;
  if (select count(*) from public.platform_fee) <> 1 then raise exception 'V should see own fee'; end if;
  update public.platform_settlement set status = 'issued' where id = current_setting('test.s1')::uuid;   -- RLS 가 0건으로 거른다
  if (select status from public.platform_settlement where id = current_setting('test.s1')::uuid) <> 'draft' then raise exception 'V issued settlement'; end if;
end $$;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.platform_settlement) + (select count(*) from public.platform_fee) + (select count(*) from public.quote) <> 0 then raise exception 'G sees platform rows'; end if;
end $$;
-- A 발행 → 항목 고정, 같은 계약은 다시 정산되지 않는다, V 알림
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.platform_settlement set status = 'issued' where id = :'s1';
do $$ begin
  begin
    insert into public.platform_settlement_line (settlement_id, tenant_id, kind, description, fee_amount) values (current_setting('test.s1')::uuid, current_setting('test.tv')::uuid, 'adjust', '조정', -1000);
    raise exception 'line added after issue';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.platform_settlement_line where settlement_id = current_setting('test.s1')::uuid) <> 1 then raise exception 'issued lines changed'; end if;
  if (select total from public.platform_settlement where id = current_setting('test.s1')::uuid) <> 30000 then raise exception 'issued total changed'; end if;
end $$;
select public.build_platform_settlement(:'tv', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date) as s2 \gset
select set_config('test.s2', :'s2', false);
do $$ begin
  if (select total from public.platform_settlement where id = current_setting('test.s2')::uuid) <> 0 then raise exception 'contract settled twice'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
do $$ begin
  if (select count(*) from public.inapp_notification where kind = 'settlement.issued' and profile_id = auth.uid()) <> 1 then raise exception 'V not notified of settlement'; end if;
end $$;
-- 광고: V 신청(금액·승인은 못 정함) → A 승인 50,000 → 다음 달 정산에 포함 → V 알림
insert into public.vendor_promotion (tenant_id, kind, starts_on, ends_on, price) values (:'tv', 'featured', (date_trunc('month', current_date) + interval '1 month')::date, (date_trunc('month', current_date) + interval '1 month 6 days')::date, 99999) returning id as pr1 \gset
select set_config('test.pr1', :'pr1', false);
do $$ begin
  if (select price from public.vendor_promotion where id = current_setting('test.pr1')::uuid) is not null then raise exception 'vendor set price'; end if;
  begin
    update public.vendor_promotion set status = 'approved' where id = current_setting('test.pr1')::uuid;
    raise exception 'vendor approved own ad';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.vendor_promotion set status = 'approved', price = 50000 where id = :'pr1';
select public.build_platform_settlement(:'tv', (date_trunc('month', current_date) + interval '1 month')::date, (date_trunc('month', current_date) + interval '2 month - 1 day')::date) as s3 \gset
select set_config('test.s3', :'s3', false);
do $$ begin
  if (select ad_total from public.platform_settlement where id = current_setting('test.s3')::uuid) <> 50000 then raise exception 'ad not billed'; end if;
  if (select billed_settlement_id from public.vendor_promotion where id = current_setting('test.pr1')::uuid) <> current_setting('test.s3')::uuid then raise exception 'promotion not marked billed'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000009', false);
do $$ begin
  if (select count(*) from public.inapp_notification where kind = 'promotion.decided' and profile_id = auth.uid()) <> 1 then raise exception 'V not notified of ad decision'; end if;
end $$;
-- G(t2 만): 플랫폼 행은 아무것도 안 보임. 노출 업체 카드는 구성원 누구나 본다
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.market_request) + (select count(*) from public.quote) + (select count(*) from public.vendor_application) + (select count(*) from public.platform_settlement) <> 0 then raise exception 'G sees platform rows'; end if;
  if (select count(*) from public.vendor_card) <> 2 then raise exception 'vendor cards should be visible to members'; end if;
end $$;
reset role;
select 'RLS platform tests passed' as result;
