\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
insert into public.campaign (tenant_id, name, channel, utm_source, utm_medium, utm_campaign, landing_path) values (:'t1', '10월 입주 인스타 광고', 'instagram', 'Instagram', 'paid social', '2026 10 Ipju', '/') returning id as c1 \gset
do $$ begin
  if (select utm_campaign from public.campaign) <> '2026_10_ipju' then raise exception 'utm not normalized: %', (select utm_campaign from public.campaign); end if;
  if (select utm_source from public.campaign) <> 'instagram' then raise exception 'source not normalized'; end if;
  begin
    insert into public.campaign (tenant_id, name, utm_source, utm_campaign) values ((select id from public.tenant where slug = 'nanomaster'), '중복', 'instagram', '2026_10_ipju');
    raise exception 'duplicate utm accepted';
  exception when unique_violation then null; end;
end $$;
-- C(기사): 캠페인 안 보임
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.campaign) <> 0 then raise exception 'C sees campaigns'; end if;
end $$;
-- E(사무, report.read 없음? content.publish 없음): 확인만
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  update public.campaign set name = 'x';
  if exists (select 1 from public.campaign where name = 'x') then raise exception 'E edited campaign'; end if;
end $$;
reset role;
select 'RLS campaign tests passed' as result;
