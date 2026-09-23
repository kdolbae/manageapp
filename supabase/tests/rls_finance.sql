\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
do $$ begin
  if (select count(*) from public.code_value where domain = 'expense_category') < 10 then raise exception 'expense categories not seeded'; end if;
end $$;
-- A(대표): 경비 등록 → 승인
insert into public.expense (tenant_id, category_code, amount, vat, vendor, memo) values (:'t1', 'material', 110000, 10000, '코팅제 상사', '글라코 3통') returning id as e1 \gset
update public.expense set status = 'approved' where id = :'e1';
do $$ begin
  if (select approved_by from public.expense where memo = '글라코 3통') <> auth.uid() then raise exception 'approved_by'; end if;
end $$;
-- C(기사, own): 본인 경비만 보이고, 승인은 못 한다
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
insert into public.expense (tenant_id, category_code, amount, vendor) values (:'t1', 'vehicle', 50000, '주유소') returning id as e2 \gset
do $$ begin
  if (select count(*) from public.expense) <> 1 then raise exception 'C should see only own expense'; end if;
  begin
    update public.expense set status = 'approved';
    raise exception 'C approved own expense';
  exception when insufficient_privilege then null; end;
end $$;
-- A: C 의 경비가 보이고 반려할 수 있다
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.expense set status = 'rejected', reject_reason = '영수증 없음' where id = :'e2';
do $$ begin
  if (select count(*) from public.expense) <> 2 then raise exception 'A should see 2 expenses'; end if;
  if (select status from public.expense where vendor = '주유소') <> 'rejected' then raise exception 'reject failed'; end if;
end $$;
-- 정산: C 가 완료한 시공 건(주방)의 품목 기사비를 모은다
select t.id as tech_c from public.technician t where t.profile_id = 'c0000000-0000-4000-8000-000000000003' and t.tenant_id = :'t1' \gset
select public.build_payout(:'t1', :'tech_c', '2026-01-01', '2027-12-31') as p1 \gset
select coalesce(sum(cl.technician_rate), 0) as expected from public.job j cross join lateral app.job_line_ids(j.id) as l(line_id) join public.contract_line cl on cl.id = l.line_id
  where j.technician_id = :'tech_c' and j.status = 'done' and j.deleted_at is null \gset
select set_config('test.expected', :'expected'::text, false);
do $$ begin
  if (select count(*) from public.payout_line) = 0 then raise exception 'payout has no lines'; end if;
  if current_setting('test.expected')::numeric <> 250000 then raise exception 'expected should be 250000 (주방 상판 코팅), got %', current_setting('test.expected'); end if;
  if (select gross from public.payout) <> current_setting('test.expected')::numeric then raise exception 'payout gross mismatch: % vs %', (select gross from public.payout), current_setting('test.expected'); end if;
  if (select withholding from public.payout) <> round(current_setting('test.expected')::numeric * 0.033) then raise exception 'withholding'; end if;
  if (select net from public.payout) <> (select gross - withholding + vat from public.payout) then raise exception 'net'; end if;
end $$;
-- 같은 시공 건은 두 번 정산되지 않는다
select public.build_payout(:'t1', :'tech_c', '2026-01-01', '2027-12-31') as p2 \gset
do $$ begin
  if (select count(*) from public.payout_line where payout_id = (select id from public.payout order by created_at desc limit 1)) <> 0 then raise exception 'job paid twice'; end if;
end $$;
delete from public.payout where id = :'p2';
-- 확정하면 줄을 못 바꾼다
update public.payout set status = 'confirmed' where id = :'p1';
do $$ begin
  begin
    insert into public.payout_line (payout_id, tenant_id, kind, amount, memo) values ((select id from public.payout), (select id from public.tenant where slug = 'nanomaster'), 'extra', 10000, '추가');
    raise exception 'line added to confirmed payout';
  exception when insufficient_privilege then null; end;
  if (select confirmed_at from public.payout) is null then raise exception 'confirmed_at'; end if;
end $$;
-- C(기사): 본인 정산서는 보이지만 못 만든다. G(t2): 아무것도 안 보인다
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.payout) <> 1 then raise exception 'C should see own payout'; end if;
  if (select count(*) from public.payout_line) = 0 then raise exception 'C should see own payout lines'; end if;
  begin
    perform public.build_payout((select id from public.tenant where slug = 'nanomaster'), (select technician_id from public.payout), '2026-01-01', '2026-12-31');
    raise exception 'C built a payout';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.payout) + (select count(*) from public.expense) <> 0 then raise exception 'G sees t1 finance'; end if;
end $$;
reset role;
select 'RLS finance tests passed' as result;
