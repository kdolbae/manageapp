\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select set_config('test.t1', :'t1', false);
-- 공지: A 작성, C 읽음 표시, 읽은 사람 수는 작성 권한자만
insert into public.notice (tenant_id, title, body, pinned) values (:'t1', '10월 시공 안내', '추석 연휴 일정', true) returning id as n1 \gset
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.notice) <> 1 then raise exception 'C should see notice'; end if;
  begin
    update public.notice set title = 'x';
    if (select title from public.notice) = 'x' then raise exception 'C edited notice'; end if;
  exception when insufficient_privilege then null; end;
end $$;
insert into public.notice_read (notice_id, profile_id) values (:'n1', auth.uid());
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.notice_read) <> 1 then raise exception 'A should see read receipts'; end if;
end $$;
-- 결재: E(사무) 상신 → 1단계 D(지점장) → 2단계 A(대표)
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
insert into public.approval_doc (tenant_id, kind, title, body, amount) values (:'t1', 'purchase', '코팅제 10통 구매', '9월 시공 물량', 630000) returning id as d1 \gset
insert into public.approval_step (doc_id, tenant_id, step_no, approver_id) values
  (:'d1', :'t1', 1, 'd0000000-0000-4000-8000-000000000004'),
  (:'d1', :'t1', 2, 'a0000000-0000-4000-8000-000000000001');
update public.approval_doc set status = 'submitted' where id = :'d1';
select set_config('test.d1', :'d1', false);
do $$ begin
  if (select doc_no from public.approval_doc) not like 'A26-%' then raise exception 'doc_no'; end if;
  if (select status from public.approval_step where step_no = 1) <> 'pending' then raise exception 'step1 not pending'; end if;
end $$;
-- C(기사): 남의 결재 문서는 안 보인다. A 가 1단계를 대신 승인하려 하면 차례가 아니므로 거부? (대표는 허용) → D 가 승인
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.approval_doc) <> 0 then raise exception 'C sees approval doc'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  update public.approval_step set status = 'approved' where step_no = 1;   -- RLS 가 0건으로 거른다
  if (select status from public.approval_step where step_no = 1) <> 'pending' then raise exception 'E approved own doc'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000004', false);
do $$ begin
  if (select count(*) from public.approval_doc) <> 1 then raise exception 'D should see doc to approve'; end if;
  if (select count(*) from public.inapp_notification where kind = 'approval.requested') <> 1 then raise exception 'D not notified'; end if;
  update public.approval_step set status = 'approved' where step_no = 2;   -- 결재자가 아니라 RLS 가 거른다
  if (select status from public.approval_step where step_no = 2) <> 'waiting' then raise exception 'D approved step 2'; end if;
end $$;
update public.approval_step set status = 'approved', comment = '확인' where doc_id = :'d1' and step_no = 1;
do $$ begin
  if (select status from public.approval_step where step_no = 2) <> 'pending' then raise exception 'step2 not pending'; end if;
  if (select current_step from public.approval_doc) <> 2 then raise exception 'current_step'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.approval_step set status = 'approved' where doc_id = :'d1' and step_no = 2;
do $$ begin
  if (select status from public.approval_doc) <> 'approved' then raise exception 'doc not approved'; end if;
  if (select decided_at from public.approval_doc) is null then raise exception 'decided_at'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  if (select count(*) from public.inapp_notification where kind = 'approval.decided') <> 1 then raise exception 'E not notified'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
-- 휴가: C 신청 → C 는 승인 못 함 → A 승인 → 잔여 계산
insert into public.leave_grant (tenant_id, profile_id, year, days) values (:'t1', 'c0000000-0000-4000-8000-000000000003', 2026, 15);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
insert into public.leave_request (tenant_id, kind, start_date, end_date, days, reason) values (:'t1', 'annual', '2026-10-06', '2026-10-07', 2, '개인 사정') returning id as l1 \gset
do $$ begin
  begin
    update public.leave_request set status = 'approved';
    raise exception 'C approved own leave';
  exception when insufficient_privilege then null; end;
  if (select granted from public.leave_balance) <> 15 then raise exception 'C should see own grant'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.leave_request set status = 'approved' where id = :'l1';
do $$ begin
  if (select used from public.leave_balance where profile_id = 'c0000000-0000-4000-8000-000000000003') <> 2 then raise exception 'leave used'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.inapp_notification where kind = 'leave.decided') <> 1 then raise exception 'C not notified'; end if;
end $$;
-- 결재 취소: E 상신 → 취소하면 남은 단계는 skipped, D 의 할 일에서 사라진다
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
insert into public.approval_doc (tenant_id, kind, title) values (:'t1', 'expense', '주차비') returning id as d2 \gset
insert into public.approval_step (doc_id, tenant_id, step_no, approver_id) values (:'d2', :'t1', 1, 'd0000000-0000-4000-8000-000000000004');
update public.approval_doc set status = 'submitted' where id = :'d2';
update public.approval_doc set status = 'canceled' where id = :'d2';
select set_config('test.d2', :'d2', false);
do $$ begin
  if (select status from public.approval_step where doc_id = current_setting('test.d2')::uuid) <> 'skipped' then raise exception 'canceled doc step not skipped'; end if;
end $$;
-- 조직도: D(지점장, member.manage) 는 부서·직위를 만들 수 있고 E(사무) 는 못 만든다. 부서를 지우면 소속은 미배정
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000004', false);
insert into public.department (tenant_id, name) values (:'t1', '시공팀') returning id as dep1 \gset
insert into public.job_position (tenant_id, name, rank) values (:'t1', '팀장', 10);
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
do $$ begin
  begin
    insert into public.department (tenant_id, name) values (current_setting('test.t1')::uuid, '몰래');
    raise exception 'E created department';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.membership set department_id = :'dep1' where profile_id = 'c0000000-0000-4000-8000-000000000003' and tenant_id = :'t1';
update public.department set deleted_at = now() where id = :'dep1';
select set_config('test.dep1', :'dep1', false);
do $$ begin
  if exists (select 1 from public.membership where department_id = current_setting('test.dep1')::uuid) then raise exception 'membership still points at deleted department'; end if;
  if exists (select 1 from public.permission_catalog where code = 'hr.manage') then raise exception 'hr.manage still in catalog'; end if;
end $$;
-- G(t2): 아무것도 안 보임
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.notice) + (select count(*) from public.approval_doc) + (select count(*) from public.leave_request) <> 0 then raise exception 'G sees t1 groupware'; end if;
end $$;
reset role;
select 'RLS groupware tests passed' as result;
