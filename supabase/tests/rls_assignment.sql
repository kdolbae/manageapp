\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
insert into public.daily_capacity (tenant_id, date, max_jobs) values (:'t1', date '2026-09-30', 6);
do $$ begin
  if (select count(*) from public.job_summary where scheduled_date = date '2026-09-30') <> 1 then raise exception 'job_summary date'; end if;
  if (select technician_name from public.job_summary where scheduled_date = date '2026-09-30') <> 'C 기사' then raise exception 'job_summary technician_name'; end if;
  if (select customer_name from public.job_summary where scheduled_date = date '2026-09-30') <> '김서연' then raise exception 'job_summary customer_name'; end if;
end $$;
-- C(기사): 본인 휴무 등록 가능, 캐파 수정 불가
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
insert into public.technician_off (tenant_id, technician_id, date, reason) values (:'t1', (select id from public.technician where name = 'C 기사'), date '2026-10-03', '개인 사정');
do $$ begin
  begin
    insert into public.daily_capacity (tenant_id, date, max_jobs) values ((select id from public.tenant limit 1), date '2026-10-01', 1);
    raise exception 'C set capacity';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.daily_capacity) <> 1 then raise exception 'C should read capacity'; end if;
end $$;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.technician_off) <> 0 then raise exception 'G sees off days'; end if;
end $$;
reset role;
select 'RLS assignment tests passed' as result;
