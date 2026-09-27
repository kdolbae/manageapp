import type { SupabaseClient } from "@supabase/supabase-js";
import { won, phone as fmtPhone } from "@/lib/format";
import { parseCashReceiptAsk, dongHo, maskIdentity, maskName, type CashReceiptAsk } from "./parse";
import { getProvider, ProviderError, type CashReceiptProvider } from "./provider";

/** 사업체 설정 integration_config(kind 'cash_receipt').config */
export type CashReceiptSettings = {
  provider?: "popbill" | "mock";
  corp_num?: string;            // 가맹점 사업자번호 (팝빌 가입 사업자)
  item_name?: string;           // 영수증 품목명 (기본: 계약 첫 품목)
  taxation?: "taxable" | "exempt";
};

export type ReceiptRow = {
  id: string; tenant_id: string; contract_id: string; provider: string; mgt_key: string; trade_usage: "income" | "expense";
  identity_num: string; customer_name: string | null; item_name: string; taxation: "taxable" | "exempt";
  total_amount: number; supply_cost: number; tax: number; status: string; confirm_num: string | null; trade_date: string | null;
  image_token: string; issued_at: string | null; created_at: string; error_message?: string | null;
};

export type Outcome = {
  status: "issued" | "resent" | "needs_info" | "nothing_to_issue" | "failed" | "ignored";
  message: string;
  receipt?: ReceiptRow;
  imageUrl?: string;
};

type ContractCand = { id: string; contract_no: string; customer_id: string; customer_name: string; customer_phone: string | null; site_id: string | null; site_name: string | null; site_unit: string | null; status: string };

const PG_ERR = { notFound: "P0002", pending: "P0003", nothing: "P0004", tooMuch: "P0005" };

export function receiptImageUrl(siteUrl: string, r: Pick<ReceiptRow, "image_token">) {
  return `${siteUrl}/api/public/v1/cash-receipt/${r.image_token}`;
}

function kstDate(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return k.toISOString().slice(0, 10).replace(/-/g, "");
}

const compact = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "");

/**
 * 채팅방 메시지 한 건 처리: 요청 기록 → 계약 찾기 → 발행 예약(이중 발행 차단) → 대행사 발행 → 결과 문장.
 * 서비스 키 클라이언트로만 부른다. 같은 (출처, 채팅방, 메시지 id) 는 한 번만 처리된다.
 */
export async function handleCashReceiptMessage(
  admin: SupabaseClient,
  input: { tenantId: string; text: string; source: "teams" | "flow" | "manual"; conversationId?: string; messageId?: string; senderName?: string; senderRef?: string; siteUrl: string },
): Promise<Outcome> {
  const ask = parseCashReceiptAsk(input.text);
  if (!ask.isRequest) return { status: "ignored", message: "" };

  const { data: req, error: reqErr } = await admin
    .from("cash_receipt_request")
    .insert({
      tenant_id: input.tenantId, source: input.source, conversation_id: input.conversationId ?? null, message_id: input.messageId ?? null,
      sender_name: input.senderName ?? null, sender_ref: input.senderRef ?? null, raw_text: input.text.slice(0, 4000), parsed: ask,
    })
    .select("id")
    .single();
  if (reqErr) {
    if (reqErr.code === "23505") return { status: "ignored", message: "" }; // 같은 메시지 재전송
    throw new Error(`request insert: ${reqErr.message}`);
  }
  const requestId = req.id as string;

  let outcome: Outcome;
  let contractId: string | null = null;
  try {
    const r = await run(admin, input.tenantId, ask, requestId, input.siteUrl);
    outcome = r.outcome;
    contractId = r.contractId;
  } catch (e) {
    outcome = { status: "failed", message: `현금영수증 처리 중 오류가 났어요. 집대리에서 확인해 주세요. (${String(e instanceof Error ? e.message : e).slice(0, 120)})` };
  }
  await admin.from("cash_receipt_request").update({
    status: outcome.status === "resent" ? "nothing_to_issue" : outcome.status === "ignored" ? "failed" : outcome.status,
    result_message: outcome.message.slice(0, 1000),
    contract_id: contractId,
    receipt_id: outcome.receipt?.id ?? null,
    processed_at: new Date().toISOString(),
  }).eq("id", requestId);
  return outcome;
}

async function run(admin: SupabaseClient, tenantId: string, ask: CashReceiptAsk, requestId: string, siteUrl: string): Promise<{ outcome: Outcome; contractId: string | null }> {
  const { data: cfgRow } = await admin.from("integration_config").select("config, is_active").eq("tenant_id", tenantId).eq("kind", "cash_receipt").maybeSingle();
  const settings = (cfgRow?.config ?? {}) as CashReceiptSettings;
  if (!cfgRow?.is_active) {
    return { outcome: { status: "failed", message: "현금영수증 자동 발행이 꺼져 있어요. 집대리 > 설정 > 연동에서 켜 주세요." }, contractId: null };
  }
  const corpNum = (settings.corp_num ?? "").replace(/\D/g, "");
  if ((settings.provider ?? "mock") === "popbill" && corpNum.length !== 10) {
    return { outcome: { status: "failed", message: "가맹점 사업자번호가 설정돼 있지 않아요. 집대리 > 설정 > 연동에서 넣어 주세요." }, contractId: null };
  }

  // 1) 계약 찾기
  const found = await findContract(admin, tenantId, ask);
  if ("message" in found) return { outcome: { status: "needs_info", message: found.message }, contractId: null };
  const c = found.contract;

  // 2) 식별번호: 지출증빙이면 사업자번호, 아니면 메시지의 휴대폰(없으면 고객 번호)
  const identity = ask.usage === "expense" ? ask.bizNo : ask.phone ?? c.customer_phone ?? undefined;
  if (!identity) {
    const msg = ask.usage === "expense" ? "지출증빙용은 사업자번호가 필요해요. '사업자번호 000-00-00000' 줄을 넣어 다시 보내 주세요." : "현금영수증 받을 휴대폰 번호가 없어요. 계약자연락처를 넣어 다시 보내 주세요.";
    return { outcome: { status: "needs_info", message: msg }, contractId: c.id };
  }

  const provider = await getProvider(settings.provider);
  const itemName = settings.item_name?.trim() || (await firstLineName(admin, c.id)) || "시공";
  const reserve = () =>
    admin.rpc("reserve_cash_receipt", {
      p: {
        tenant_id: tenantId, contract_id: c.id, request_id: requestId, amount: ask.amount ?? null, identity_num: identity,
        trade_usage: ask.usage, customer_name: ask.name ?? c.customer_name, item_name: itemName, taxation: settings.taxation ?? "taxable", provider: provider.id,
      },
    });

  // 3) 발행 예약. 앞선 요청이 발행 중(pending)으로 남아 있으면 먼저 마무리한다.
  let { data: reserved, error } = await reserve();
  if (error?.code === PG_ERR.pending) {
    await settlePending(admin, provider, c.id, corpNum, c.contract_no);
    ({ data: reserved, error } = await reserve());
  }
  if (error) {
    if (error.code === PG_ERR.nothing) return { outcome: await nothingToIssue(admin, c, siteUrl), contractId: c.id };
    if (error.code === PG_ERR.tooMuch) {
      const { data: remain } = await admin.rpc("cash_receipt_unissued", { p_contract: c.id });
      return { outcome: { status: "needs_info", message: `요청 금액이 발행할 수 있는 금액보다 커요. ${c.contract_no} 은 ${won(Number(remain ?? 0))}원까지 발행할 수 있어요.` }, contractId: c.id };
    }
    if (error.code === PG_ERR.pending) return { outcome: { status: "failed", message: `${c.contract_no} 의 앞선 현금영수증이 아직 처리 중이에요. 잠시 뒤 다시 보내 주세요.` }, contractId: c.id };
    throw new Error(error.message);
  }

  // 4) 발행
  const receipt = reserved as ReceiptRow;
  const done = await issueReserved(admin, provider, receipt, corpNum, c.contract_no);
  if (done.status !== "issued") {
    return { outcome: { status: "failed", message: `현금영수증 발행에 실패했어요: ${done.error_message ?? "알 수 없는 오류"}. 입력값을 확인한 뒤 다시 보내 주세요.`, receipt: done }, contractId: c.id };
  }
  const who = [maskName(done.customer_name), maskIdentity(done.identity_num)].filter(Boolean).join(" · ");
  return {
    outcome: {
      status: "issued",
      message: `현금영수증 발행했어요${provider.id === "mock" ? " (시험 발행, 국세청 전송 없음)" : ""}. ${who} · ${won(done.total_amount)}원 · 승인번호 ${done.confirm_num} · 계약 ${c.contract_no}`,
      receipt: done,
      imageUrl: receiptImageUrl(siteUrl, done),
    },
    contractId: c.id,
  };
}

async function firstLineName(admin: SupabaseClient, contractId: string): Promise<string | null> {
  const { data } = await admin.from("contract_line").select("name").eq("contract_id", contractId).order("sort_order", { ascending: true }).limit(3);
  const names = ((data ?? []) as { name: string }[]).map((l) => l.name).filter(Boolean);
  if (!names.length) return null;
  return names.length > 1 ? `${names[0]} 외` : names[0];
}

/** 연락처(·이름·주소·계약번호)로 계약 하나를 고른다. 하나로 못 좁히면 무엇이 부족한지 문장으로 돌려준다. */
export async function findContract(admin: SupabaseClient, tenantId: string, ask: CashReceiptAsk): Promise<{ contract: ContractCand } | { message: string }> {
  let cands: ContractCand[] = [];
  const cols = "id, contract_no, customer_id, customer_name, customer_phone, site_id, site_name, site_unit, status";

  if (ask.contractNo) {
    const { data } = await admin.from("contract_summary").select(cols).eq("tenant_id", tenantId).eq("contract_no", ask.contractNo);
    cands = (data ?? []) as ContractCand[];
    if (!cands.length) return { message: `계약번호 ${ask.contractNo} 를 찾지 못했어요.` };
  } else {
    if (!ask.phone) return { message: "계약자연락처(휴대폰 번호)가 없어요. 현장주소·계약자명·계약자연락처를 넣어 다시 보내 주세요." };
    const { data: customers } = await admin.from("customer").select("id, name").eq("tenant_id", tenantId).is("deleted_at", null).or(`phone.eq.${ask.phone},phone2.eq.${ask.phone}`);
    let cs = (customers ?? []) as { id: string; name: string }[];
    if (!cs.length) return { message: `연락처 ${fmtPhone(ask.phone)} 로 등록된 고객이 없어요. 번호를 확인하거나 '계약번호' 줄을 넣어 주세요.` };
    if (ask.name) {
      const byName = cs.filter((x) => compact(x.name) === compact(ask.name));
      if (!byName.length) return { message: `연락처 ${fmtPhone(ask.phone)} 는 ${cs.map((x) => maskName(x.name)).join(", ")} 님으로 등록돼 있어요. 계약자명을 확인해 주세요.` };
      cs = byName;
    }
    const { data } = await admin.from("contract_summary").select(cols).eq("tenant_id", tenantId).in("customer_id", cs.map((x) => x.id)).order("contract_date", { ascending: false }).limit(20);
    cands = (data ?? []) as ContractCand[];
  }
  if (ask.phone && ask.contractNo) {
    const same = cands.filter((x) => !x.customer_phone || x.customer_phone === ask.phone);
    if (!same.length) return { message: `계약번호 ${ask.contractNo} 의 계약자 연락처가 ${fmtPhone(ask.phone)} 와 달라요. 계약번호나 연락처를 확인해 주세요.` };
    cands = same;
  }
  cands = cands.filter((x) => x.status !== "canceled");
  if (!cands.length) return { message: "진행 중인 계약을 찾지 못했어요. 취소된 계약이거나 다른 사업체 계약일 수 있어요." };
  if (cands.length === 1) return { contract: cands[0] };

  // 여러 건이면 현장주소(동·호수·단지명)로 좁힌다
  if (ask.address) {
    const siteIds = cands.map((x) => x.site_id).filter((x): x is string => Boolean(x));
    const { data: sites } = siteIds.length ? await admin.from("site").select("id, name, address, dong, ho").in("id", siteIds) : { data: [] };
    const byId = new Map(((sites ?? []) as { id: string; name: string; address: string | null; dong: string | null; ho: string | null }[]).map((s) => [s.id, s]));
    const want = dongHo(ask.address);
    const addr = compact(ask.address);
    const score = (x: ContractCand) => {
      const s = x.site_id ? byId.get(x.site_id) : undefined;
      if (!s) return 0;
      let n = 0;
      const sDong = s.dong?.replace(/\D/g, "") || dongHo(s.address).dong;
      const sHo = s.ho?.replace(/\D/g, "") || dongHo(s.address).ho;
      if (want.dong && sDong === want.dong) n += 2;
      if (want.ho && sHo === want.ho) n += 2;
      if (s.name && addr.includes(compact(s.name))) n += 1;
      if (s.address && (addr.includes(compact(s.address)) || compact(s.address).includes(addr))) n += 1;
      return n;
    };
    const scored = cands.map((x) => ({ x, n: score(x) }));
    const best = Math.max(...scored.map((s) => s.n));
    if (best > 0) cands = scored.filter((s) => s.n === best).map((s) => s.x);
    if (cands.length === 1) return { contract: cands[0] };
  }

  // 그래도 여러 건이면 발행할 금액이 남은 계약만
  const withRemain: { x: ContractCand; remain: number }[] = [];
  for (const x of cands) {
    const { data } = await admin.rpc("cash_receipt_unissued", { p_contract: x.id });
    withRemain.push({ x, remain: Number(data ?? 0) });
  }
  const open = withRemain.filter((w) => w.remain > 0);
  if (open.length === 1) return { contract: open[0].x };
  const list = withRemain
    .map((w) => `${[w.x.contract_no, w.x.site_name, w.x.site_unit].filter(Boolean).join(" ")} (발행 가능 ${won(w.remain)}원)`)
    .join(" / ");
  return { message: `이 연락처로 계약이 ${withRemain.length}건 있어요: ${list}. '계약번호 C26-0000' 줄을 넣어 다시 보내 주세요.` };
}

/** 예약된 pending 영수증을 대행사에 발행하고 상태를 확정한다. 같은 문서번호가 이미 있으면 조회로 맞춘다. */
async function issueReserved(admin: SupabaseClient, provider: CashReceiptProvider, r: ReceiptRow, corpNum: string, contractNo: string): Promise<ReceiptRow> {
  const input = {
    corpNum, mgtKey: r.mgt_key, tradeDate: kstDate(new Date(r.created_at)), usage: r.trade_usage, identityNum: r.identity_num,
    customerName: r.customer_name, itemName: r.item_name, taxation: r.taxation, total: Number(r.total_amount), supply: Number(r.supply_cost), tax: Number(r.tax), orderNumber: contractNo,
  };
  let patch: Record<string, unknown>;
  try {
    const res = await provider.issue(input);
    patch = { status: "issued", confirm_num: res.confirmNum, trade_date: res.tradeDate, provider_response: res.raw ?? null };
  } catch (e) {
    if (e instanceof ProviderError && e.duplicate) {
      const look = await provider.lookup(corpNum, r.mgt_key);
      if (look.state === "issued") patch = { status: "issued", confirm_num: look.confirmNum, trade_date: look.tradeDate, provider_response: look.raw ?? null };
      else patch = { status: "failed", error_code: e.code, error_message: `문서번호 중복, 조회 결과 미발행 (${e.message})`.slice(0, 300) };
    } else if (e instanceof ProviderError) {
      patch = { status: "failed", error_code: e.code, error_message: e.message.slice(0, 300) };
    } else {
      // 네트워크 오류 등: 발행됐는지 알 수 없으므로 pending 으로 두고 다음 요청 때 조회로 맞춘다
      throw e;
    }
  }
  const { data, error } = await admin.from("cash_receipt").update(patch).eq("id", r.id).eq("status", "pending").select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as ReceiptRow;
  const { data: now } = await admin.from("cash_receipt").select("*").eq("id", r.id).single();
  return now as ReceiptRow;
}

async function settlePending(admin: SupabaseClient, provider: CashReceiptProvider, contractId: string, corpNum: string, contractNo: string) {
  const { data } = await admin.from("cash_receipt").select("*").eq("contract_id", contractId).eq("status", "pending");
  for (const r of (data ?? []) as ReceiptRow[]) {
    // 방금 다른 요청이 만든 것일 수 있으니 1분 안 된 건 건드리지 않는다
    if (Date.now() - new Date(r.created_at).getTime() < 60_000) continue;
    try {
      await issueReserved(admin, provider, r, corpNum, contractNo);
    } catch {
      /* 다음 요청에서 다시 */
    }
  }
}

async function nothingToIssue(admin: SupabaseClient, c: ContractCand, siteUrl: string): Promise<Outcome> {
  const { data } = await admin.from("cash_receipt").select("*").eq("contract_id", c.id).eq("status", "issued").order("issued_at", { ascending: false });
  const issued = (data ?? []) as ReceiptRow[];
  if (!issued.length) {
    return { status: "nothing_to_issue", message: `${c.contract_no} 원장에 현금·계좌이체 입금 기록이 없어요. 입금을 먼저 기록한 뒤 다시 보내 주세요.` };
  }
  const total = issued.reduce((s, r) => s + Number(r.total_amount), 0);
  const last = issued[0];
  return {
    status: "resent",
    message: `${c.contract_no} 의 현금·계좌이체 입금은 이미 모두 발행됐어요 (${issued.length}건, 합계 ${won(total)}원). 마지막 영수증을 다시 보내요. 승인번호 ${last.confirm_num}`,
    receipt: last,
    imageUrl: receiptImageUrl(siteUrl, last),
  };
}
