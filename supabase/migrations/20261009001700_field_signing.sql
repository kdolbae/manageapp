-- =============================================================================
-- D14: 현장 계약 — 시공기사가 현장에서 고객·계약을 등록하고, 고객이 그 자리(태블릿·박람회 노트북)나
--      자기 계약 링크(/c/<slug>/<token>)에서 전자서명한다.
--  · 시공기사 역할(own)에 고객·계약 등록 권한을 연다. 영업 담당은 본인만 가능(RLS in_scope 규칙 그대로).
--  · 계약을 쓸 수 있는 사람은 그 계약의 시공 건(일정)도 만들고 볼 수 있다 (own 범위 영업자·기사 포함).
--  · 서명 원본(PNG data URL)·동의 항목·약관 문구·계약 내용 스냅샷·해시를 한 행에 남긴다 (수정·삭제 불가).
--  · 서명 뒤 계약자·현장·품목·금액이 바뀌면 material_hash 가 달라져 화면에서 "다시 서명 필요" 로 보인다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 시공기사: 본인 범위(own)에서 고객·계약 등록
-- -----------------------------------------------------------------------------
insert into public.role_permission (role_id, permission)
  select '10000000-0000-4000-8000-000000000004'::uuid, unnest(array['customer.write','contract.write'])
  on conflict do nothing;

-- 계약의 영업 담당 (시공 건 정책에서 "내 계약의 시공 건" 판정용)
create or replace function app.contract_owner(p_contract uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select sales_owner_id from public.contract where id = p_contract
$$;

-- 시공 건: 계약을 쓸 수 있는 범위면(own = 영업 담당 본인) 시공 건도 보고 만들 수 있다
drop policy if exists job_select on public.job;
create policy job_select on public.job for select to authenticated
  using (app.has_perm(tenant_id, 'job.read')
     and (app.in_scope(tenant_id, branch_id, app.job_owner(id))
          or app.in_scope(tenant_id, branch_id, app.contract_owner(contract_id))
          or exists (select 1 from public.contract c where c.id = contract_id and app.my_partner_id(tenant_id) is not null and c.partner_id = app.my_partner_id(tenant_id))));
drop policy if exists job_insert on public.job;
create policy job_insert on public.job for insert to authenticated
  with check ((app.has_perm(tenant_id, 'job.write') and app.in_scope(tenant_id, branch_id, null, true))
           or (app.has_perm(tenant_id, 'contract.write') and app.in_scope(tenant_id, branch_id, app.contract_owner(contract_id), true)));
drop policy if exists job_line_write on public.job_line;
create policy job_line_write on public.job_line for all to authenticated
  using (exists (select 1 from public.job j where j.id = job_id
                 and (app.has_perm(j.tenant_id, 'job.write')
                      or (app.has_perm(j.tenant_id, 'contract.write') and app.in_scope(j.tenant_id, j.branch_id, app.contract_owner(j.contract_id), true)))))
  with check (exists (select 1 from public.job j where j.id = job_id
                 and (app.has_perm(j.tenant_id, 'job.write')
                      or (app.has_perm(j.tenant_id, 'contract.write') and app.in_scope(j.tenant_id, j.branch_id, app.contract_owner(j.contract_id), true)))));

-- -----------------------------------------------------------------------------
-- 2. 약관: 사업체 설정 settings.contract_terms, 비어 있으면 기본 문구
-- -----------------------------------------------------------------------------
create or replace function app.default_contract_terms() returns text
language sql immutable as $$
  select $t$제1조 (계약의 내용) 계약자는 위 품목·수량·금액대로 시공을 의뢰하고, 시공사는 이를 성실히 이행합니다.
제2조 (대금) 계약금은 계약 시, 잔금은 시공 완료 당일 지급합니다. 입금 내역은 계약 링크 페이지에서 확인할 수 있습니다.
제3조 (일정) 시공 예정일은 입주·현장 사정에 따라 협의해 바꿀 수 있으며, 바뀌면 문자나 전화로 안내합니다.
제4조 (취소·환불) 시공 3일 전까지 취소하면 계약금 전액을 환불합니다. 그 이후 취소는 이미 쓴 자재·출장 실비를 뺀 금액을 환불합니다.
제5조 (하자보수) 시공 완료일부터 1년 동안 시공 하자를 무상으로 보수합니다. 사용자 과실·천재지변으로 인한 손상은 제외합니다.
제6조 (개인정보) 수집한 개인정보(이름·연락처·주소)는 계약 이행·하자보수·법정 보관 목적으로만 쓰고, 보관 기간이 끝나면 지체 없이 파기합니다.
제7조 (전자서명) 이 계약은 전자문서 및 전자거래 기본법에 따라 전자서명으로 체결하며, 서명 당시의 계약 내용과 약관을 함께 보관합니다.$t$
$$;

create or replace function app.contract_terms(tid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(t.settings->>'contract_terms'), ''), app.default_contract_terms())
  from public.tenant t where t.id = tid
$$;

-- 서명 당시 계약 내용. jobs·memo·sales_owner 는 참고용, 나머지(계약자·현장·품목·금액)가 서명의 효력 범위(material)
create or replace function app.contract_snapshot(p_contract uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'contract_no', c.contract_no,
    'contract_date', c.contract_date,
    'tenant', jsonb_build_object('name', t.name, 'business_no', t.business_no),
    'customer', jsonb_build_object('name', cu.name, 'phone', cu.phone),
    'site', jsonb_build_object('name', s.name, 'dong', s.dong, 'ho', s.ho, 'address', s.address),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'work_area_code', l.work_area_code, 'qty', l.qty, 'unit_price', l.unit_price, 'discount', l.discount, 'amount', l.amount)
                                        order by l.sort_order, l.created_at), '[]'::jsonb)
              from public.contract_line l where l.contract_id = c.id),
    'sale_total', cs.sale_total,
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('work_area_code', j.work_area_code, 'kind', j.kind, 'scheduled_date', j.scheduled_date, 'time_slot', j.time_slot)
                                       order by j.sort_order, j.created_at), '[]'::jsonb)
             from public.job j where j.contract_id = c.id and j.deleted_at is null and j.status <> 'canceled'),
    'sales_owner', p.display_name,
    'memo', c.memo)
  from public.contract c
  join public.tenant t on t.id = c.tenant_id
  join public.contract_summary cs on cs.id = c.id
  left join public.customer cu on cu.id = c.customer_id
  left join public.site s on s.id = c.site_id
  left join public.profile p on p.id = c.sales_owner_id
  where c.id = p_contract
$$;

create or replace function app.contract_material(p_snapshot jsonb) returns text
language sql immutable as $$
  select (p_snapshot - 'jobs' - 'memo' - 'sales_owner')::text
$$;

create or replace function app.sha256_hex(p text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;

create or replace function app.contract_material_hash(p_contract uuid) returns text
language sql stable security definer set search_path = public as $$
  select app.sha256_hex(app.contract_material(app.contract_snapshot(p_contract)))
$$;

-- -----------------------------------------------------------------------------
-- 3. 서명 기록 (추가만 가능, 수정·삭제 없음. 다시 서명하면 새 행, 최신 행이 유효)
-- -----------------------------------------------------------------------------
create table public.contract_signature (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id),
  contract_id     uuid not null references public.contract(id),
  method          text not null default 'device' check (method in ('device','link')),   -- device: 직원 기기(태블릿·노트북)에서 그 자리 서명, link: 고객 계약 링크
  signer_name     text not null check (length(btrim(signer_name)) between 1 and 60),
  signature_data  text not null check (signature_data like 'data:image/png;base64,%' and length(signature_data) between 200 and 300000),
  consents        jsonb not null default '{}'::jsonb,   -- {terms, privacy, marketing}
  terms_text      text not null,                        -- 서명 당시 약관 문구
  snapshot        jsonb not null,                       -- 서명 당시 계약 내용 (app.contract_snapshot)
  material_hash   text not null,                        -- sha256(계약자·현장·품목·금액) — 서명 뒤 계약이 바뀌었는지 확인
  record_hash     text not null,                        -- sha256(스냅샷|약관|서명 이미지) — 기록 위변조 확인
  witnessed_by    uuid references public.profile(id),   -- 현장 기기에서 서명을 받은 직원 (link 는 null)
  ip              text,
  user_agent      text,
  signed_at       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
comment on table public.contract_signature is '고객 전자서명. 서명 당시 계약 내용·약관을 스냅샷으로 함께 보관한다. 행은 추가만 하고 고치지 않는다.';
create index contract_signature_contract_idx on public.contract_signature (contract_id, signed_at desc);

alter table public.contract add column signed_at timestamptz;   -- 최근 서명 시각 (목록·필터용 비정규화)

create or replace function app.contract_signature_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.contract;
begin
  select * into c from public.contract where id = new.contract_id and deleted_at is null;
  if c.id is null then raise exception 'contract not found' using errcode = '42501'; end if;
  if c.canceled_at is not null then raise exception '취소된 계약에는 서명할 수 없습니다' using errcode = '22023'; end if;
  if coalesce((new.consents->>'terms')::boolean, false) is not true or coalesce((new.consents->>'privacy')::boolean, false) is not true then
    raise exception '계약 내용과 개인정보 수집·이용에 동의해야 서명할 수 있습니다' using errcode = '22023';
  end if;
  new.tenant_id     := c.tenant_id;
  new.signer_name   := btrim(new.signer_name);
  new.terms_text    := app.contract_terms(c.tenant_id);
  new.snapshot      := app.contract_snapshot(c.id);
  new.material_hash := app.sha256_hex(app.contract_material(new.snapshot));
  new.record_hash   := app.sha256_hex(new.snapshot::text || '|' || new.terms_text || '|' || new.signature_data);
  new.signed_at     := now();
  if auth.uid() is not null then
    new.method := 'device'; new.witnessed_by := auth.uid();      -- 로그인한 직원 기기
  else
    new.method := 'link'; new.witnessed_by := null;              -- 서비스 키(고객 링크)
  end if;
  return new;
end $$;
create trigger contract_signature_before_insert before insert on public.contract_signature for each row execute function app.contract_signature_before_insert();

create or replace function app.contract_signature_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.contract; title text; body text;
begin
  update public.contract set signed_at = new.signed_at where id = new.contract_id returning * into c;
  if coalesce((new.consents->>'marketing')::boolean, false) then
    update public.customer set marketing_consent = true, consent_at = now() where id = c.customer_id and marketing_consent = false;
  end if;
  insert into public.status_history (tenant_id, entity, entity_id, from_status, to_status, actor_id, note)
  values (new.tenant_id, 'contract', new.contract_id, null, 'signed', new.witnessed_by,
          new.signer_name || case when new.method = 'link' then ' · 고객 링크' else ' · 현장 기기' end);
  if new.method = 'link' then
    title := '고객 서명 완료 · ' || c.contract_no;
    body  := new.signer_name || ' 고객이 계약 링크에서 서명했습니다.';
    if c.sales_owner_id is not null then
      insert into public.inapp_notification (tenant_id, profile_id, kind, title, body, link)
      values (c.tenant_id, c.sales_owner_id, 'contract.signed', title, body, '/contracts/' || c.id);
    else
      perform app.notify_members(c.tenant_id, 'contract.write', 'contract.signed', title, body, '/contracts/' || c.id);
    end if;
  end if;
  return new;
end $$;
create trigger contract_signature_after_insert after insert on public.contract_signature for each row execute function app.contract_signature_after_insert();
create trigger contract_signature_audit after insert or update or delete on public.contract_signature for each row execute function app.audit();

alter table public.contract_signature enable row level security;
-- 조회: 계약이 보이면 서명도 보인다
create policy contract_signature_select on public.contract_signature for select to authenticated
  using (exists (select 1 from public.contract c where c.id = contract_id));
-- 현장 서명 받기: 계약이 보이고, 계약 쓰기 권한이 있거나 그 계약에 배정된 기사
create policy contract_signature_insert on public.contract_signature for insert to authenticated
  with check (exists (select 1 from public.contract c where c.id = contract_id)
              and (app.has_perm(tenant_id, 'contract.write') or app.is_assigned_technician(contract_id)));
-- update/delete 정책 없음: 기록은 고치지 않는다

-- -----------------------------------------------------------------------------
-- 4. RPC
-- -----------------------------------------------------------------------------
-- 직원 기기 서명 화면·계약 상세: 약관, 현재 계약 내용, 현재 해시, 최근 서명. 계약이 안 보이면 null
create or replace function public.contract_signing_info(p_contract uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare tid uuid;
begin
  select tenant_id into tid from public.contract where id = p_contract and deleted_at is null;
  if tid is null then return null; end if;
  return jsonb_build_object(
    'terms', app.contract_terms(tid),
    'snapshot', app.contract_snapshot(p_contract),
    'material_hash', app.contract_material_hash(p_contract),
    'signature', (select jsonb_build_object('id', s.id, 'signed_at', s.signed_at, 'signer_name', s.signer_name, 'method', s.method,
                                            'material_hash', s.material_hash, 'record_hash', s.record_hash, 'signature_data', s.signature_data,
                                            'consents', s.consents, 'witnessed_by', p.display_name)
                  from public.contract_signature s left join public.profile p on p.id = s.witnessed_by
                  where s.contract_id = p_contract order by s.signed_at desc limit 1));
end $$;
grant execute on function public.contract_signing_info(uuid) to authenticated;
revoke execute on function public.contract_signing_info(uuid) from anon, public;

-- 고객 링크: 서명 상태·약관 (서비스 키 전용). 이름은 가려서
create or replace function public.customer_signing(p_slug text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tenant; c public.contract;
begin
  t := app.tenant_by_slug(p_slug);
  if t.id is null or p_token is null or length(p_token) < 16 then return null; end if;
  select * into c from public.contract where tenant_id = t.id and public_token = p_token and deleted_at is null;
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'can_sign', c.canceled_at is null,
    'terms', app.contract_terms(t.id),
    'phone_check', exists (select 1 from public.customer cu where cu.id = c.customer_id and length(coalesce(cu.phone, '')) >= 4),
    'signature', (select jsonb_build_object('signed_at', s.signed_at, 'signer_name', app.mask_name(s.signer_name), 'method', s.method,
                                            'record_hash', left(s.record_hash, 12), 'signature_data', s.signature_data,
                                            'changed', s.material_hash <> app.contract_material_hash(c.id))
                  from public.contract_signature s where s.contract_id = c.id order by s.signed_at desc limit 1));
end $$;

-- 고객 링크에서 서명 (서비스 키 전용). 휴대폰 뒷 4자리로 본인 확인
create or replace function public.customer_sign_contract(p_slug text, p_token text, p_signer_name text, p_phone_tail text, p_signature_data text, p_consents jsonb, p_ip text, p_user_agent text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.tenant; c public.contract; cu public.customer; sid uuid;
begin
  t := app.tenant_by_slug(p_slug);
  if t.id is null or p_token is null or length(p_token) < 16 then raise exception 'invalid link' using errcode = '42501'; end if;
  select * into c from public.contract where tenant_id = t.id and public_token = p_token and deleted_at is null;
  if c.id is null then raise exception 'invalid link' using errcode = '42501'; end if;
  select * into cu from public.customer where id = c.customer_id;
  if length(coalesce(cu.phone, '')) >= 4 and right(cu.phone, 4) <> regexp_replace(coalesce(p_phone_tail, ''), '\D', '', 'g') then
    raise exception '휴대폰 번호 뒷자리가 계약 정보와 다릅니다' using errcode = '22023';
  end if;
  insert into public.contract_signature (tenant_id, contract_id, signer_name, signature_data, consents, ip, user_agent)
  values (c.tenant_id, c.id, p_signer_name, p_signature_data, coalesce(p_consents, '{}'::jsonb), p_ip, p_user_agent)
  returning id into sid;
  return sid;
end $$;

revoke execute on function public.customer_signing(text, text) from public, anon, authenticated;
revoke execute on function public.customer_sign_contract(text, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.customer_signing(text, text) to service_role;
grant execute on function public.customer_sign_contract(text, text, text, text, text, jsonb, text, text) to service_role;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
