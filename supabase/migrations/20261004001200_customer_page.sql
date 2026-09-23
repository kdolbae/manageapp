-- =============================================================================
-- D10: 고객 페이지 — 계약마다 비밀 링크(public_token)로 고객이 로그인 없이 시공 일정·사진·잔액을 보고 후기를 남긴다
--  브랜드 페이지(/c/<slug>)의 문의 폼도 여기 함수로 들어온다. 모두 서비스 키로만 호출한다 (anon 직접 호출 금지)
-- =============================================================================

alter table public.contract add column public_token text unique default encode(gen_random_bytes(12), 'hex');
update public.contract set public_token = encode(gen_random_bytes(12), 'hex') where public_token is null;

-- 이름 가리기: 김서연 → 김*연
create or replace function app.mask_name(n text) returns text
language sql immutable as $$
  select case when n is null then null
              when length(n) <= 1 then n
              when length(n) = 2 then left(n, 1) || '*'
              else left(n, 1) || repeat('*', length(n) - 2) || right(n, 1) end
$$;

create or replace function app.tenant_by_slug(p_slug text) returns public.tenant
language sql stable security definer set search_path = public as $$
  select * from public.tenant where slug = p_slug and status = 'active' and deleted_at is null
$$;

-- 고객 페이지 자료. 없으면 null
create or replace function public.customer_page(p_slug text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tenant; c record;
begin
  t := app.tenant_by_slug(p_slug);
  if t.id is null or p_token is null or length(p_token) < 16 then return null; end if;
  select ct.id, ct.tenant_id, ct.contract_no, ct.contract_date, ct.approval_status, ct.canceled_at, ct.memo,
         cs.sale_total, cs.paid_total, cs.balance, cs.status, cs.site_name, cs.site_unit, cs.customer_name, cu.phone as customer_phone,
         s.address as site_address, b.name as branch_name
    into c
  from public.contract ct
  join public.contract_summary cs on cs.id = ct.id
  left join public.customer cu on cu.id = ct.customer_id
  left join public.site s on s.id = ct.site_id
  left join public.branch b on b.id = ct.branch_id
  where ct.tenant_id = t.id and ct.public_token = p_token and ct.deleted_at is null;
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'slug', t.slug, 'brand', t.brand),
    'contract', jsonb_build_object(
      'id', c.id, 'contract_no', c.contract_no, 'contract_date', c.contract_date, 'status', c.status,
      'approval_status', c.approval_status, 'canceled_at', c.canceled_at,
      'customer_name', app.mask_name(c.customer_name), 'customer_phone_tail', right(c.customer_phone, 4),
      'site_name', c.site_name, 'site_unit', c.site_unit, 'site_address', c.site_address, 'branch_name', c.branch_name,
      'sale_total', c.sale_total, 'paid_total', c.paid_total, 'balance', c.balance),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'work_area_code', l.work_area_code, 'qty', l.qty, 'amount', l.amount) order by l.sort_order, l.created_at), '[]'::jsonb)
              from public.contract_line l where l.contract_id = c.id),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', j.id, 'work_area_code', j.work_area_code,
                'work_area', (select cv.label from public.code_value cv where cv.tenant_id = c.tenant_id and cv.domain = 'work_area' and cv.code = j.work_area_code),
                'kind', j.kind, 'status', j.status, 'scheduled_date', j.scheduled_date, 'time_slot', j.time_slot,
                'technician', tch.name, 'started_at', j.started_at, 'completed_at', j.completed_at)
              order by j.scheduled_date nulls last, j.sort_order), '[]'::jsonb)
             from public.job j left join public.technician tch on tch.id = j.technician_id
             where j.contract_id = c.id and j.deleted_at is null and j.status <> 'canceled'),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('path', m.path, 'kind', m.kind, 'job_id', m.job_id, 'taken_at', coalesce(m.taken_at, m.created_at)) order by m.created_at), '[]'::jsonb)
               from public.media_asset m where m.contract_id = c.id and m.deleted_at is null and m.kind in ('before','after','process')),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('entry_type', e.entry_type, 'amount', e.amount, 'occurred_at', e.occurred_at) order by e.occurred_at), '[]'::jsonb)
                 from public.ledger_entry e where e.contract_id = c.id and e.voided_at is null and public.ledger_side(e.entry_type) = 'payment'),
    'review', (select jsonb_build_object('rating', r.rating, 'body', r.body, 'created_at', r.created_at, 'response', r.response, 'consent_marketing', r.consent_marketing)
               from public.review r where r.contract_id = c.id and r.channel = 'app' and r.deleted_at is null order by r.created_at desc limit 1)
  );
end $$;

-- 고객 후기: 계약당 하나, 다시 보내면 덮어쓴다. 새 후기는 발행 권한자에게 알림
create or replace function public.customer_submit_review(p_slug text, p_token text, p_rating int, p_body text, p_author text, p_consent boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tenant; c record; rid uuid;
begin
  t := app.tenant_by_slug(p_slug);
  if t.id is null then raise exception 'unknown tenant' using errcode = '42501'; end if;
  select id, tenant_id, branch_id, customer_id into c from public.contract where tenant_id = t.id and public_token = p_token and deleted_at is null;
  if c.id is null then raise exception 'unknown contract' using errcode = '42501'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'rating must be 1..5'; end if;
  select id into rid from public.review where contract_id = c.id and channel = 'app' and deleted_at is null order by created_at desc limit 1;
  if rid is null then
    insert into public.review (tenant_id, branch_id, contract_id, customer_id, channel, rating, body, author_name, consent_marketing, status)
    values (c.tenant_id, c.branch_id, c.id, c.customer_id, 'app', p_rating, left(p_body, 2000), left(p_author, 40), coalesce(p_consent, false), 'pending')
    returning id into rid;
    insert into public.inapp_notification (tenant_id, profile_id, kind, title, body, link)
      select distinct c.tenant_id, m.profile_id, 'review.new', '새 고객 후기 ' || repeat('★', p_rating), left(coalesce(p_body, ''), 120), '/content/reviews'
      from public.membership m join public.role_permission rp on rp.role_id = m.role_id
      where m.tenant_id = c.tenant_id and m.status = 'active' and rp.permission = 'content.publish';
  else
    update public.review set rating = p_rating, body = left(p_body, 2000), author_name = left(p_author, 40), consent_marketing = coalesce(p_consent, false), status = 'pending'
    where id = rid;
  end if;
  return rid;
end $$;

-- 브랜드 페이지 문의 (서비스 키). 문의 알림 트리거가 그대로 돈다
create or replace function public.customer_inquiry(p_slug text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tenant; iid uuid;
begin
  t := app.tenant_by_slug(p_slug);
  if t.id is null then raise exception 'unknown tenant' using errcode = '42501'; end if;
  insert into public.inquiry (tenant_id, channel, kind, name, phone, email, address, apt, message, source_page, utm, extra)
  values (t.id, 'web', p->>'kind', p->>'name', p->>'phone', p->>'email', p->>'address', p->>'apt', p->>'message',
          coalesce(p->>'source_page', '/c/' || p_slug), coalesce(p->'utm', '{}'::jsonb), coalesce(p->'extra', '{}'::jsonb))
  returning id into iid;
  return iid;
end $$;

revoke execute on function public.customer_page(text, text) from public, anon, authenticated;
revoke execute on function public.customer_submit_review(text, text, int, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.customer_inquiry(text, jsonb) from public, anon, authenticated;
grant execute on function public.customer_page(text, text) to service_role;
grant execute on function public.customer_submit_review(text, text, int, text, text, boolean) to service_role;
grant execute on function public.customer_inquiry(text, jsonb) to service_role;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
