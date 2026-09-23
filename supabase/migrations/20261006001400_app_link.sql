-- =============================================================================
-- D13: 집대리 소비자 앱(kdolbae/jipdarie) 연동
--  1) 앱 컨설팅 요청이 문의 인입함으로 들어온다 (inquiry.channel = 'app', 앱 서버가 문의 API 키로 전달)
--  2) 상품마다 앱 공종 id(app_service_id)를 붙여, 실제 계약 금액을 앱 예상가격 기준으로 내보낸다
--  3) 앱에서 계약 비밀 링크를 붙여 넣으면 customer_page() 를 그대로 읽는다 (새 함수 없음)
--  모두 서비스 키로만 호출한다 (anon 직접 호출 금지)
-- =============================================================================

alter table public.inquiry drop constraint inquiry_channel_check;
alter table public.inquiry add constraint inquiry_channel_check
  check (channel in ('web','phone','kakao','partner','walk_in','fair','app','other'));

-- 앱 공종 id (grout, nano_coating, cleaning …). 앱 src/data/services.ts 의 id 와 같아야 한다
alter table public.product add column app_service_id text
  check (app_service_id is null or app_service_id ~ '^[a-z][a-z0-9_]{1,39}$');
create index product_app_service_idx on public.product (tenant_id, app_service_id) where app_service_id is not null and deleted_at is null;

-- 주소 첫 단어 → 앱 지역 이름. '경기도 화성시 …' → '경기'. 모르면 null
create or replace function app.region_of(addr text) returns text
language sql immutable as $$
  select case
    when w is null or w = '' then null
    when w like '서울%' then '서울'  when w like '부산%' then '부산'  when w like '대구%' then '대구'
    when w like '인천%' then '인천'  when w like '광주%' then '광주'  when w like '대전%' then '대전'
    when w like '울산%' then '울산'  when w like '세종%' then '세종'  when w like '경기%' then '경기'
    when w like '강원%' then '강원'  when w like '제주%' then '제주'
    when w like '충청북%' or w like '충북%' then '충북'  when w like '충청남%' or w like '충남%' then '충남'
    when w like '전라북%' or w like '전북%' then '전북'  when w like '전라남%' or w like '전남%' then '전남'
    when w like '경상북%' or w like '경북%' then '경북'  when w like '경상남%' or w like '경남%' then '경남'
    else null end
  from (select split_part(btrim(addr), ' ', 1) as w) x
$$;

-- 앱 예상가격용 계약 금액 집계. 계약 1건 = 표본 1개 (같은 공종 품목은 합산).
--  취소·반려·삭제 계약 제외, 기간은 최근 p_months 개월. 표본이 p_min_sample(최소 5) 미만인 묶음은 내보내지 않는다
--  (개별 계약 금액이 드러나지 않게). 앱은 30건 이상일 때만 기준으로 쓴다.
create or replace function public.app_price_stats(p_slug text, p_months int default 6, p_min_sample int default 5) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tenant; since date; entries jsonb;
begin
  t := app.tenant_by_slug(p_slug);
  if t.id is null then return null; end if;
  since := (current_date - make_interval(months => greatest(1, least(coalesce(p_months, 6), 24))))::date;
  with per_contract as (
    select p.app_service_id as service_id, app.region_of(s.address) as region, c.id, sum(l.amount) as amount
    from public.contract_line l
    join public.contract c on c.id = l.contract_id
    join public.product p on p.id = l.product_id
    left join public.site s on s.id = c.site_id
    where c.tenant_id = t.id and c.deleted_at is null and c.canceled_at is null and c.approval_status <> 'rejected'
      and c.contract_date >= since and p.app_service_id is not null
    group by 1, 2, 3
    having sum(l.amount) > 0
  ), scoped as (
    select service_id, region, amount from per_contract where region is not null
    union all
    select service_id, '전국', amount from per_contract
  ), agg as (
    select service_id, region, count(*) as n,
           percentile_disc(0.15) within group (order by amount) as low,
           round(avg(amount)) as avg,
           percentile_disc(0.85) within group (order by amount) as high
    from scoped
    group by service_id, region
    having count(*) >= greatest(coalesce(p_min_sample, 5), 5)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'service_id', service_id, 'region', region, 'sample_size', n,
           'low', low, 'avg', avg, 'high', high) order by service_id, region = '전국' desc, region), '[]'::jsonb)
    into entries from agg;
  return jsonb_build_object('tenant', t.slug, 'since', since, 'until', current_date, 'entries', entries);
end $$;

revoke execute on function public.app_price_stats(text, int, int) from public, anon, authenticated;
grant execute on function public.app_price_stats(text, int, int) to service_role;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
