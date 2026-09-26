\set ON_ERROR_STOP on
-- 계약 토큰은 직원만 본다 (고객 페이지 링크 안내용)
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select public_token as tok from public.contract where contract_no = 'C26-0001' \gset
reset role;
select set_config('test.tok', :'tok', false);
-- anon 은 함수 자체를 못 부른다
set role anon;
do $$ begin
  begin
    perform public.customer_page('nanomaster', current_setting('test.tok'));
    raise exception 'anon called customer_page';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- 서비스 키: 자료 조회, 틀린 토큰·slug 는 null
set role service_role;
do $$
declare d jsonb;
begin
  d := public.customer_page('nanomaster', current_setting('test.tok'));
  if d is null then raise exception 'customer page null'; end if;
  if d->'tenant'->>'name' is null then raise exception 'tenant missing'; end if;
  if jsonb_array_length(d->'jobs') <> 2 then raise exception 'jobs count % ', jsonb_array_length(d->'jobs'); end if;
  if (d->'contract'->>'customer_name') not like '%*%' then raise exception 'name not masked: %', d->'contract'->>'customer_name'; end if;
  if (d->'contract'->>'balance') is null then raise exception 'balance missing'; end if;
  if public.customer_page('nanomaster', 'ffffffffffffffffffffffff') is not null then raise exception 'wrong token accepted'; end if;
  if public.customer_page('mjcon', current_setting('test.tok')) is not null then raise exception 'wrong slug accepted'; end if;
end $$;
-- 후기: 처음은 insert, 두 번째는 update
select public.customer_submit_review('nanomaster', :'tok', 5, '친절하고 꼼꼼했어요', '김서연', true) as r1 \gset
select public.customer_submit_review('nanomaster', :'tok', 4, '수정된 후기', '김서연', false) as r2 \gset
do $$ begin
  if (select count(*) from public.review where channel = 'app') <> 1 then raise exception 'review duplicated'; end if;
  if (select rating from public.review where channel = 'app') <> 4 then raise exception 'review not updated'; end if;
  if (select count(*) from public.inapp_notification where kind = 'review.new') = 0 then raise exception 'no review notification'; end if;
end $$;
-- 브랜드 페이지 문의
select public.customer_inquiry('nanomaster', '{"name":"이민호","phone":"010-5555-6666","kind":"견적","message":"욕실 줄눈 문의","utm":{"utm_source":"instagram"}}') as i1 \gset
do $$ begin
  if (select channel from public.inquiry where name = '이민호') <> 'web' then raise exception 'inquiry channel'; end if;
  if (select source_page from public.inquiry where name = '이민호') <> '/c/nanomaster' then raise exception 'source_page'; end if;
  begin
    perform public.customer_inquiry('no-such-tenant', '{"name":"x"}');
    raise exception 'unknown tenant accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'RLS customer page tests passed' as result;
