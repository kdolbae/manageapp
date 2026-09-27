-- =============================================================================
-- 현금영수증: Teams 채팅방 요청 → 계약 원장의 현금·계좌이체 입금 중 아직 발행 안 된 금액으로 자동 발행
--  - cash_receipt          발행 기록(원장처럼 고치지 않는다: 상태만 pending → issued/failed, issued → canceled)
--  - cash_receipt_request  들어온 요청(채팅 메시지) 기록. 같은 메시지는 한 번만 처리한다
--  - teams_conversation    Teams 채팅방·채널 ↔ 사업체 연결 (연결 코드로만 만든다)
--  발행 대행사 호출은 서버(서비스 키)만 한다. 사용자는 조회만 한다.
-- =============================================================================

alter table public.integration_config drop constraint if exists integration_config_kind_check;
alter table public.integration_config add constraint integration_config_kind_check
  check (kind in ('teams_webhook','web_inquiry','kakao_solapi','anthropic','push_vapid','cash_receipt','teams_bot'));

-- Teams 채팅방 ↔ 사업체
create table public.teams_conversation (
  conversation_id  text primary key,                     -- Bot Framework conversation.id
  tenant_id        uuid not null references public.tenant(id),
  conv_type        text not null default 'groupChat' check (conv_type in ('groupChat','channel','personal')),
  title            text,
  service_url      text not null,                        -- 답장 보낼 Bot Connector 주소
  aad_tenant_id    text,
  purposes         text[] not null default '{cash_receipt}',
  is_active        boolean not null default true,
  linked_by_name   text,                                 -- 연결 코드를 보낸 Teams 사용자 이름
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index teams_conversation_tenant_idx on public.teams_conversation (tenant_id);

-- 들어온 요청
create table public.cash_receipt_request (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  source           text not null default 'teams' check (source in ('teams','flow','manual')),
  conversation_id  text,
  message_id       text,
  sender_name      text,
  sender_ref       text,                                 -- Teams AAD object id 등
  raw_text         text not null,
  parsed           jsonb not null default '{}'::jsonb,   -- {address, name, phone, contract_no, amount, biz_no}
  status           text not null default 'received'
                     check (status in ('received','issued','needs_info','nothing_to_issue','failed')),
  result_message   text,
  contract_id      uuid references public.contract(id),
  receipt_id       uuid,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);
create unique index cash_receipt_request_msg_uq on public.cash_receipt_request (source, conversation_id, message_id) where message_id is not null;
create index cash_receipt_request_tenant_idx on public.cash_receipt_request (tenant_id, created_at desc);

-- 발행 기록
create table public.cash_receipt (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id),
  contract_id      uuid not null references public.contract(id),
  customer_id      uuid references public.customer(id),
  request_id       uuid references public.cash_receipt_request(id),
  provider         text not null,                        -- popbill | mock
  mgt_key          text not null,                        -- 대행사 문서번호 (재시도해도 같은 번호 → 이중 발행 차단)
  trade_usage      text not null default 'income' check (trade_usage in ('income','expense')),  -- 소득공제용·지출증빙용
  identity_num     text not null,                        -- 휴대폰 번호 또는 사업자번호 (숫자만)
  customer_name    text,
  item_name        text not null,
  taxation         text not null default 'taxable' check (taxation in ('taxable','exempt')),
  total_amount     numeric(14,0) not null check (total_amount > 0),
  supply_cost      numeric(14,0) not null,
  tax              numeric(14,0) not null,
  status           text not null default 'pending' check (status in ('pending','issued','failed','canceled')),
  confirm_num      text,                                 -- 국세청 승인번호
  trade_date       text,                                 -- yyyyMMdd (대행사 응답)
  provider_response jsonb,
  error_code       text,
  error_message    text,
  image_token      text not null unique default encode(gen_random_bytes(18), 'hex'),  -- 영수증 이미지 공개 주소용
  issued_at        timestamptz,
  canceled_at      timestamptz,
  created_by       uuid references public.profile(id),
  created_at       timestamptz not null default now(),
  unique (tenant_id, mgt_key),
  check (supply_cost + tax = total_amount)
);
create index cash_receipt_contract_idx on public.cash_receipt (contract_id, created_at desc);
alter table public.cash_receipt_request add constraint cash_receipt_request_receipt_fk foreign key (receipt_id) references public.cash_receipt(id);

-- 금액·대상은 고치지 않는다. 상태는 pending → issued|failed, issued → canceled 만.
create or replace function app.guard_cash_receipt_update() returns trigger
language plpgsql as $$
begin
  if new.total_amount <> old.total_amount or new.supply_cost <> old.supply_cost or new.tax <> old.tax
     or new.contract_id <> old.contract_id or new.mgt_key <> old.mgt_key or new.identity_num <> old.identity_num
     or new.tenant_id <> old.tenant_id or new.trade_usage <> old.trade_usage or new.image_token <> old.image_token then
    raise exception 'cash receipts are immutable' using errcode = '42501';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('issued','failed'))
    or (old.status = 'issued' and new.status = 'canceled')) then
    raise exception 'invalid cash receipt status change % -> %', old.status, new.status using errcode = '42501';
  end if;
  if new.status = 'issued' and old.status <> 'issued' then new.issued_at := coalesce(new.issued_at, now()); end if;
  if new.status = 'canceled' and old.status <> 'canceled' then new.canceled_at := coalesce(new.canceled_at, now()); end if;
  return new;
end $$;
create trigger cash_receipt_guard_update before update on public.cash_receipt for each row execute function app.guard_cash_receipt_update();
create trigger cash_receipt_audit after insert or update or delete on public.cash_receipt for each row execute function app.audit();
create trigger teams_conversation_touch before update on public.teams_conversation for each row execute function app.touch();

-- 발행 대상 금액: 취소되지 않은 현금·계좌이체 수납(영수증 번호가 이미 적힌 건 제외) − 같은 수단 환불
--                 − 이미 발행했거나 발행 중인 현금영수증
create or replace function public.cash_receipt_unissued(p_contract uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0,
    coalesce((select sum(public.ledger_sign(e.entry_type) * e.amount) from public.ledger_entry e
              where e.contract_id = p_contract and e.voided_at is null
                and public.ledger_side(e.entry_type) = 'payment'
                and e.pay_method_code in ('cash','transfer')
                and e.receipt_no is null), 0)
  - coalesce((select sum(r.total_amount) from public.cash_receipt r
              where r.contract_id = p_contract and r.status in ('pending','issued')), 0))
$$;
revoke execute on function public.cash_receipt_unissued(uuid) from public, anon;
grant execute on function public.cash_receipt_unissued(uuid) to authenticated, service_role;

-- 발행 예약: 계약을 잠그고 남은 금액을 계산해 pending 한 건을 만든다. 동시에 같은 계약 요청이 와도 한 건만 된다.
--  p: {tenant_id, contract_id, request_id?, amount?, identity_num, trade_usage?, customer_name?, item_name, taxation?, provider}
create or replace function public.reserve_cash_receipt(p jsonb) returns public.cash_receipt
language plpgsql security definer set search_path = public as $$
declare
  c public.contract; remain numeric; amt numeric; supply numeric; r public.cash_receipt; rid uuid := gen_random_uuid();
  tax_mode text := coalesce(p->>'taxation', 'taxable');
begin
  select * into c from public.contract where id = (p->>'contract_id')::uuid and tenant_id = (p->>'tenant_id')::uuid for update;
  if c.id is null or c.deleted_at is not null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.cash_receipt where contract_id = c.id and status = 'pending') then
    raise exception 'cash receipt pending' using errcode = 'P0003';
  end if;
  remain := public.cash_receipt_unissued(c.id);
  amt := coalesce(nullif(p->>'amount', '')::numeric, remain);
  if remain <= 0 then
    raise exception 'nothing to issue' using errcode = 'P0004';
  end if;
  if amt <= 0 or amt > remain then
    raise exception 'amount % exceeds unissued %', amt, remain using errcode = 'P0005';
  end if;
  supply := case when tax_mode = 'taxable' then round(amt / 1.1) else amt end;
  insert into public.cash_receipt (id, tenant_id, contract_id, customer_id, request_id, provider, mgt_key, trade_usage, identity_num,
                                   customer_name, item_name, taxation, total_amount, supply_cost, tax)
  values (rid, c.tenant_id, c.id, c.customer_id, nullif(p->>'request_id', '')::uuid, p->>'provider',
          'JD' || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD') || '-' || upper(substr(replace(rid::text, '-', ''), 1, 12)),
          coalesce(p->>'trade_usage', 'income'), app.norm_phone(p->>'identity_num'), p->>'customer_name',
          left(coalesce(nullif(p->>'item_name', ''), '시공'), 100), tax_mode, amt, supply, amt - supply)
  returning * into r;
  return r;
end $$;
revoke execute on function public.reserve_cash_receipt(jsonb) from public, anon, authenticated;
grant execute on function public.reserve_cash_receipt(jsonb) to service_role;

-- 채팅방 연결: 연동 설정에서 받은 코드(30분 유효)를 채팅방에 보내면 그 채팅방이 사업체에 연결된다
create or replace function public.link_teams_conversation(p_code text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select ic.tenant_id into tid from public.integration_config ic
  where ic.kind = 'teams_bot' and ic.config ->> 'link_code' = upper(trim(p_code))
    and (ic.config ->> 'link_code_expires_at')::timestamptz > now();
  if tid is null then return null; end if;
  insert into public.teams_conversation (conversation_id, tenant_id, conv_type, title, service_url, aad_tenant_id, linked_by_name)
  values (p->>'conversation_id', tid, coalesce(p->>'conv_type', 'groupChat'), p->>'title', p->>'service_url', p->>'aad_tenant_id', p->>'linked_by_name')
  on conflict (conversation_id) do update
    set tenant_id = excluded.tenant_id, service_url = excluded.service_url, is_active = true, linked_by_name = excluded.linked_by_name;
  -- 코드는 한 번 쓰면 끝
  update public.integration_config set config = config - 'link_code' - 'link_code_expires_at' where tenant_id = tid and kind = 'teams_bot';
  return tid;
end $$;
revoke execute on function public.link_teams_conversation(text, jsonb) from public, anon, authenticated;
grant execute on function public.link_teams_conversation(text, jsonb) to service_role;

-- RLS: 발행 기록은 원장 조회 권한 + 계약이 보이면, 요청·채팅방은 대표(tenant.manage)만. 쓰기는 서버만.
alter table public.cash_receipt          enable row level security;
alter table public.cash_receipt_request  enable row level security;
alter table public.teams_conversation    enable row level security;

create policy cash_receipt_select on public.cash_receipt for select to authenticated
  using (app.has_perm(tenant_id, 'ledger.read') and exists (select 1 from public.contract c where c.id = contract_id));
create policy cash_receipt_request_select on public.cash_receipt_request for select to authenticated
  using (app.has_perm(tenant_id, 'tenant.manage'));
create policy teams_conversation_select on public.teams_conversation for select to authenticated
  using (app.has_perm(tenant_id, 'tenant.manage'));
-- 대표는 채팅방 연결을 끌 수 있다 (is_active)
create policy teams_conversation_update on public.teams_conversation for update to authenticated
  using (app.has_perm(tenant_id, 'tenant.manage')) with check (app.has_perm(tenant_id, 'tenant.manage'));

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on all functions in schema app from anon, public;
