\set ON_ERROR_STOP on
-- 집대리 앱 연동: 앱 문의 채널, 공종 매핑, 계약 금액 집계 (rls_customer_page 다음에 실행)

-- 지역 이름
do $$ begin
  if app.region_of('경기도 화성시 동탄대로 1') <> '경기' then raise exception 'region 경기'; end if;
  if app.region_of('서울특별시 서초구') <> '서울' then raise exception 'region 서울'; end if;
  if app.region_of(' 충청남도 천안시') <> '충남' then raise exception 'region 충남'; end if;
  if app.region_of('래미안 원베일리') is not null then raise exception 'unknown region should be null'; end if;
  if app.region_of(null) is not null then raise exception 'null region'; end if;
end $$;

-- 픽스처: 나노마스터에 줄눈 상품(app_service_id=grout) + 경기 6건 · 서울 1건 계약, 취소 1건, 다른 사업체 1건
do $$
declare
  nm uuid := (select id from public.tenant where slug = 'nanomaster');
  mj uuid := (select id from public.tenant where slug = 'mjcon');
  pg uuid; pm uuid; cu uuid; st uuid; ct uuid; i int;
begin
  insert into public.product (tenant_id, code, name, price, app_service_id) values (nm, 'APP-GROUT', '욕실 줄눈', 400000, 'grout') returning id into pg;
  insert into public.product (tenant_id, code, name, price, app_service_id) values (mj, 'APP-GROUT', '줄눈', 999000, 'grout') returning id into pm;
  for i in 1..8 loop
    insert into public.customer (tenant_id, name) values (case when i = 8 then mj else nm end, '앱고객' || i) returning id into cu;
    insert into public.site (tenant_id, customer_id, name, address)
      values (case when i = 8 then mj else nm end, cu, '테스트 단지', case when i = 7 then '서울특별시 강남구' else '경기도 화성시' end) returning id into st;
    insert into public.contract (tenant_id, contract_no, customer_id, site_id, contract_date, canceled_at)
      values (case when i = 8 then mj else nm end, 'APP-' || i, cu, st, current_date - 10, case when i = 6 then now() end) returning id into ct;
    -- 계약마다 줄눈 품목 두 줄 (합산되는지 확인)
    insert into public.contract_line (tenant_id, contract_id, product_id, name, unit_price)
      values (case when i = 8 then mj else nm end, ct, case when i = 8 then pm else pg end, '줄눈', 300000 + i * 10000),
             (case when i = 8 then mj else nm end, ct, case when i = 8 then pm else pg end, '줄눈 현관', 50000);
  end loop;
  -- 오래된 계약(기간 밖)
  insert into public.customer (tenant_id, name) values (nm, '옛고객') returning id into cu;
  insert into public.contract (tenant_id, contract_no, customer_id, contract_date) values (nm, 'APP-OLD', cu, current_date - 400) returning id into ct;
  insert into public.contract_line (tenant_id, contract_id, product_id, name, unit_price) values (nm, ct, pg, '줄눈', 100000);
end $$;

-- 공종 id 형식
do $$ begin
  begin
    update public.product set app_service_id = 'Bad Id' where code = 'APP-GROUT';
    raise exception 'bad app_service_id accepted';
  exception when check_violation then null; end;
end $$;

-- 앱 문의 채널
insert into public.integration_config (tenant_id, kind, config)
  select id, 'web_inquiry', jsonb_build_object('key_hash', encode(sha256('app-test-key'::bytea), 'hex')) from public.tenant where slug = 'nanomaster'
  on conflict (tenant_id, kind) do update set config = excluded.config, is_active = true;

-- anon · authenticated 는 집계 함수를 못 부른다
set role anon;
do $$ begin
  begin
    perform public.app_price_stats('nanomaster');
    raise exception 'anon called app_price_stats';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  begin
    perform public.app_price_stats('nanomaster');
    raise exception 'authenticated called app_price_stats';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set role service_role;
do $$
declare d jsonb; e jsonb; iid uuid;
begin
  d := public.app_price_stats('nanomaster');
  -- 전국: 1~5, 7 = 6건 (취소·기간 밖·다른 사업체 제외). 경기: 5건. 서울: 1건 → 표본 부족으로 빠진다
  select x into e from jsonb_array_elements(d->'entries') x where x->>'service_id' = 'grout' and x->>'region' = '전국';
  if e is null then raise exception 'no 전국 entry: %', d; end if;
  if (e->>'sample_size')::int <> 6 then raise exception '전국 sample %', e->>'sample_size'; end if;
  -- 두 줄 합산: 계약 i 의 금액 = 350000 + i*10000 → 최소 360000, 최대 420000
  if (e->>'low')::numeric < 360000 or (e->>'high')::numeric > 420000 then raise exception 'range % ~ %', e->>'low', e->>'high'; end if;
  if (e->>'avg')::numeric <> round((360000 + 370000 + 380000 + 390000 + 400000 + 420000) / 6.0) then raise exception 'avg %', e->>'avg'; end if;
  select x into e from jsonb_array_elements(d->'entries') x where x->>'region' = '경기';
  if (e->>'sample_size')::int <> 5 then raise exception '경기 sample %', e; end if;
  if exists (select 1 from jsonb_array_elements(d->'entries') x where x->>'region' = '서울') then raise exception '서울 should be hidden (1 sample)'; end if;
  if (d->>'tenant') <> 'nanomaster' then raise exception 'tenant slug'; end if;
  -- 최소 표본을 5 아래로 낮출 수 없다
  if exists (select 1 from jsonb_array_elements(public.app_price_stats('nanomaster', 6, 1)->'entries') x where x->>'region' = '서울') then
    raise exception 'min sample floor not enforced';
  end if;
  if public.app_price_stats('no-such-tenant') is not null then raise exception 'unknown tenant'; end if;
  -- 다른 사업체의 999000 이 섞이지 않는다
  if exists (select 1 from jsonb_array_elements(d->'entries') x where (x->>'high')::numeric >= 999000) then raise exception 'cross-tenant leak'; end if;

  -- 앱 문의: channel 'app', external_id 로 중복 방지
  iid := public.ingest_web_inquiry(encode(sha256('app-test-key'::bytea), 'hex'),
    '{"channel":"app","kind":"컨설팅 요청 (카카오톡)","name":"앱사용자","phone":"010-7777-8888","external_id":"consult-1","extra":{"home":{"pyeong":34}}}');
  if iid is null then raise exception 'app inquiry not inserted'; end if;
  if public.ingest_web_inquiry(encode(sha256('app-test-key'::bytea), 'hex'), '{"channel":"app","name":"앱사용자","external_id":"consult-1"}') is not null then
    raise exception 'duplicate app inquiry inserted';
  end if;
  if (select channel from public.inquiry where id = iid) <> 'app' then raise exception 'channel not app'; end if;
end $$;
reset role;
select 'RLS app link tests passed' as result;
