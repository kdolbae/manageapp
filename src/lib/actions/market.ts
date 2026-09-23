"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";
import { REGIONS, quoteTotal, type QuoteItem } from "@/lib/market";
import { todayKST } from "@/lib/dates";

/* ---------------------------------------------------------------------------
 * 집대리 마켓 — 협력업체(로그인 사업체) 쪽 서버 액션.
 * 견적 제출·수정·철회, 채택 견적 → 계약 전환, 고객과의 대화, 업체 소개, 상단 노출(광고) 신청.
 * 채택·탈락(고객), 노출 켜기·수수료·광고 승인(운영자)은 여기서 못 한다 — DB 트리거가 42501 로 막는다.
 * ------------------------------------------------------------------------- */

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optDate = z.string().trim().optional().transform((v) => (v ? v : null)).pipe(ymd.nullable());
/** "300,000" 같은 금액 문자열 → 정수(원). 비어 있으면 null, 숫자가 아니면 검증에서 걸린다. */
const money = z
  .string()
  .trim()
  .optional()
  .transform((v) => {
    if (!v) return null;
    const digits = v.replace(/[^\d]/g, "");
    return digits ? Number(digits) : Number.NaN;
  })
  .pipe(z.number().int().min(0).max(99_999_999_999).nullable());
const fail = (message: string): ActionState => ({ error: message });

/** RLS·트리거가 막으면(42501) 한국어 안내. 트리거가 이미 한국어로 이유를 말했으면 그 말을 그대로 보여준다. */
function friendly(error: { code?: string; message: string }, denied = "권한이 없습니다.") {
  if (error.code === "42501") return /[가-힣]/.test(error.message) ? error.message : denied;
  return error.message;
}

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

/** 폼 값을 객체로. multi 는 체크박스처럼 여러 값을 배열로 받는다. */
function fields(formData: FormData, multi: string[] = []) {
  const obj: Record<string, unknown> = Object.fromEntries(formData);
  for (const k of multi) obj[k] = formData.getAll(k).filter((v): v is string => typeof v === "string");
  return obj;
}

function revalidateMarket(...paths: string[]) {
  revalidatePath("/market", "layout");
  for (const p of paths) revalidatePath(p);
}

// ---------------------------------------------------------------- 견적
/** 폼이 그리는 줄 수(5)보다 넉넉히 읽는다 — "use server" 파일은 async 함수만 내보낼 수 있어 상수를 공유하지 않는다 */
const MAX_ITEM_ROWS = 10;

/** 품목 줄(item_name_1 … item_price_N)을 읽는다. 셋 다 비어 있는 줄은 건너뛰고, 일부만 적힌 줄은 오류. */
function parseItems(formData: FormData): QuoteItem[] | string {
  const items: QuoteItem[] = [];
  for (let i = 1; i <= MAX_ITEM_ROWS; i++) {
    const name = String(formData.get(`item_name_${i}`) ?? "").trim();
    const qtyRaw = String(formData.get(`item_qty_${i}`) ?? "").trim();
    const priceRaw = String(formData.get(`item_price_${i}`) ?? "").trim();
    if (!name && !qtyRaw && !priceRaw) continue;
    if (!name) return `${i}번째 품목의 이름을 적어 주세요.`;
    if (name.length > 60) return "품목 이름은 60자 이내로 적어 주세요.";
    const qty = qtyRaw ? Number(qtyRaw.replace(/,/g, "")) : 1;
    const unit_price = priceRaw ? Number(priceRaw.replace(/[^\d]/g, "")) : 0;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 9999 || !Number.isInteger(qty * 100)) return `${i}번째 품목의 수량을 확인해 주세요 (0.01 단위).`;
    if (!Number.isInteger(unit_price) || unit_price < 0 || unit_price > 99_999_999_999) return `${i}번째 품목의 단가를 확인해 주세요.`;
    items.push({ name, qty, unit_price });
  }
  return items;
}

/** 품목이 있으면 합계가 견적 금액, 없으면 총액 칸. 0원 견적은 받지 않는다. */
function quoteAmount(items: QuoteItem[], amount: number | null): number | string {
  const total = items.length ? quoteTotal(items) : amount;
  if (total == null) return "견적 금액을 적거나 품목을 넣어 주세요.";
  if (total <= 0) return "견적 금액은 0원보다 커야 합니다.";
  return total;
}

const quoteInput = z.object({
  amount: money,
  message: optText(1000),
  available_from: optDate,
  valid_until: optDate,
});
const QUOTE_INVALID = "금액(숫자)과 날짜(YYYY-MM-DD)를 확인해 주세요.";

export async function submitQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = quoteInput.extend({ request_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(QUOTE_INVALID);
  const items = parseItems(formData);
  if (typeof items === "string") return fail(items);
  const amount = quoteAmount(items, parsed.data.amount);
  if (typeof amount === "string") return fail(amount);
  const { session, supabase, tenantId } = await ctx("market.write");
  const { request_id, message, available_from, valid_until } = parsed.data;
  const { error } = await supabase
    .from("quote")
    .insert({ request_id, tenant_id: tenantId, amount, items, message, available_from, valid_until, created_by: session.user.id });
  if (error) {
    if (error.code === "23505") return fail("이 요청에는 이미 견적을 냈습니다. 아래에서 고쳐 주세요.");
    return fail(friendly(error, "이 요청에 견적을 낼 수 없습니다. 업체 소개의 분류·지역이 맞고 노출 중인지 확인해 주세요."));
  }
  revalidateMarket(`/market/requests/${request_id}`, "/market/quotes");
  return { ok: "견적을 냈습니다. 고객이 선택하면 알림이 옵니다." };
}

/** 제출 상태의 견적만 금액·품목·메시지를 고칠 수 있다 (채택·마감 뒤에는 트리거가 막는다). */
export async function updateQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = quoteInput.extend({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(QUOTE_INVALID);
  const items = parseItems(formData);
  if (typeof items === "string") return fail(items);
  const amount = quoteAmount(items, parsed.data.amount);
  if (typeof amount === "string") return fail(amount);
  const { supabase, tenantId } = await ctx("market.write");
  const { id, message, available_from, valid_until } = parsed.data;
  const { data: q } = await supabase.from("quote").select("id, request_id, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!q) return fail("견적을 찾지 못했습니다.");
  if (q.status !== "submitted") return fail("제출 상태의 견적만 고칠 수 있습니다.");
  const { error, count } = await supabase
    .from("quote")
    .update({ amount, items, message, available_from, valid_until }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("status", "submitted");
  if (error) return fail(friendly(error, "견적을 고칠 권한이 없습니다."));
  if (!count) return fail("견적을 고치지 못했습니다. 상태가 바뀌었는지 확인해 주세요.");
  revalidateMarket(`/market/requests/${q.request_id}`, "/market/quotes");
  return { ok: "견적을 고쳤습니다." };
}

/** 제출 → 철회. 철회한 견적은 되살릴 수 없다 (같은 요청에 다시 낼 수도 없다). */
export async function withdrawQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("market.write");
  const { data: q } = await supabase.from("quote").select("id, request_id, status").eq("id", parsed.data.id).eq("tenant_id", tenantId).maybeSingle();
  if (!q) return fail("견적을 찾지 못했습니다.");
  if (q.status !== "submitted") return fail("제출 상태의 견적만 철회할 수 있습니다.");
  const { error, count } = await supabase
    .from("quote")
    .update({ status: "withdrawn" }, { count: "exact" })
    .eq("id", q.id)
    .eq("tenant_id", tenantId)
    .eq("status", "submitted");
  if (error) return fail(friendly(error, "견적을 철회할 권한이 없습니다."));
  if (!count) return fail("견적을 철회하지 못했습니다.");
  revalidateMarket(`/market/requests/${q.request_id}`, "/market/quotes");
  return { ok: "견적을 철회했습니다." };
}

/** 고객이 선택한 견적을 우리 사업체의 고객·현장·계약으로 만든다 (RPC, 두 번 불러도 같은 계약). 성공하면 계약 화면으로. */
export async function convertQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("market.write");
  const { data: q } = await supabase.from("quote").select("id, request_id, status, contract_id").eq("id", parsed.data.id).eq("tenant_id", tenantId).maybeSingle();
  if (!q) return fail("견적을 찾지 못했습니다.");
  if (q.contract_id) redirect(`/contracts/${q.contract_id}`);
  if (q.status !== "accepted") return fail("고객이 선택한 견적만 계약으로 만들 수 있습니다.");
  const { data, error } = await supabase.rpc("convert_quote_to_contract", { p_quote: q.id });
  if (error) return fail(friendly(error, "계약으로 만들 권한이 없습니다. (계약 등록 권한이 필요합니다)"));
  if (!data) return fail("계약을 만들지 못했습니다.");
  revalidateMarket(`/market/requests/${q.request_id}`, "/market/quotes", "/market/settlements");
  revalidatePath("/contracts");
  redirect(`/contracts/${String(data)}`);
}

// ---------------------------------------------------------------- 대화
export async function sendVendorMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ request_id: uuid, body: z.string().trim().min(1).max(2000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("메시지를 적어 주세요 (2000자 이내).");
  const { session, supabase, tenantId } = await ctx("market.write");
  const { request_id, body } = parsed.data;
  const { error } = await supabase
    .from("request_message")
    .insert({ request_id, tenant_id: tenantId, sender: "vendor", sender_id: session.user.id, body });
  if (error) return fail(friendly(error, "이 요청에는 메시지를 보낼 수 없습니다."));
  revalidatePath(`/market/requests/${request_id}`);
  return { ok: "보냈습니다." };
}

/**
 * 고객 메시지 읽음 표시(우리 사업체 대화방). 요청 상세 화면이 서버에서 그려질 때 부른다.
 * 렌더링 도중이라 revalidatePath 는 부르지 않는다 (Next 가 렌더 중 재검증을 막는다). 화면은 이미 최신 데이터로 그려진다.
 */
export async function markMessagesRead(requestId: string): Promise<void> {
  const id = uuid.safeParse(requestId);
  if (!id.success) return;
  const session = await requireTenant();
  if (!session.can("market.read")) return;
  const supabase = await createClient();
  await supabase
    .from("request_message")
    .update({ read_at: new Date().toISOString() })
    .eq("request_id", id.data)
    .eq("tenant_id", session.current.tenant_id)
    .eq("sender", "customer")
    .is("read_at", null);
}

// ---------------------------------------------------------------- 업체 소개
const HIGHLIGHT_MAX = 6;
const profileInput = z.object({
  categories: z.array(z.string().regex(/^[a-z_]+$/)).max(30),
  regions: z.array(z.enum(REGIONS)).max(REGIONS.length),
  intro: optText(1000),
  highlights: z.string().optional(),
  min_price: money,
  response_note: optText(120),
});

/** 업체 소개 등록·수정. 노출 여부(is_listed)는 보내지 않는다 — 운영자만 켤 수 있고, 업체가 바꾸면 트리거가 막는다. */
export async function upsertVendorProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = profileInput.safeParse(fields(formData, ["categories", "regions"]));
  if (!parsed.success) return fail("소개(1000자 이내)·최소 금액(숫자)·지역을 확인해 주세요.");
  const highlights = (parsed.data.highlights ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (highlights.length > HIGHLIGHT_MAX) return fail(`강점은 ${HIGHLIGHT_MAX}줄까지 적을 수 있습니다.`);
  if (highlights.some((h) => h.length > 60)) return fail("강점은 한 줄에 60자 이내로 적어 주세요.");
  const { session, supabase, tenantId } = await ctx("market.write");
  // 분류는 서비스 분류표에 있는 코드만 남긴다
  const { data: cats } = await supabase.from("platform_category").select("code");
  const known = new Set(((cats ?? []) as { code: string }[]).map((c) => c.code));
  const categories = Array.from(new Set(parsed.data.categories.filter((c) => known.has(c))));
  if (categories.length === 0) return fail("서비스 분류를 하나 이상 골라 주세요. 분류가 맞는 요청만 우리에게 옵니다.");
  const regions = Array.from(new Set(parsed.data.regions));
  const { intro, min_price, response_note } = parsed.data;
  const { error } = await supabase
    .from("vendor_profile")
    .upsert({ tenant_id: tenantId, categories, regions, intro, highlights, min_price, response_note }, { onConflict: "tenant_id" });
  if (error) return fail(friendly(error, "업체 소개를 편집할 권한이 없습니다."));
  revalidateMarket("/market/profile");
  revalidatePath(`/vendors/${session.current.tenant.slug}`);
  return { ok: "저장했습니다. 노출은 집대리 운영자가 확인한 뒤 켭니다." };
}

// ---------------------------------------------------------------- 상단 노출(광고)
const PROMOTION_MAX_DAYS = 90;
const promotionInput = z.object({
  kind: z.enum(["featured", "banner"]),
  placement: z.enum(["home", "category"]),
  category_code: z.string().trim().regex(/^[a-z_]*$/).optional().transform((v) => (v ? v : null)),
  starts_on: ymd,
  ends_on: ymd,
  note: optText(500),
});

/** 상단 노출 신청. 금액·승인은 운영자가 정한다 (트리거가 status=requested, price=null 로 고정). */
export async function requestPromotion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = promotionInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("종류·위치·기간(YYYY-MM-DD)을 확인해 주세요.");
  const { kind, placement, starts_on, ends_on, note } = parsed.data;
  const category_code = placement === "category" ? parsed.data.category_code : null;
  if (placement === "category" && !category_code) return fail("분류 화면에 노출하려면 분류를 골라 주세요.");
  if (ends_on < starts_on) return fail("끝 날짜가 시작 날짜보다 앞설 수 없습니다.");
  if (starts_on < todayKST()) return fail("지난 날짜에는 신청할 수 없습니다.");
  const span = (new Date(`${ends_on}T00:00:00Z`).getTime() - new Date(`${starts_on}T00:00:00Z`).getTime()) / 86_400_000;
  if (!Number.isFinite(span) || span >= PROMOTION_MAX_DAYS) return fail(`한 번에 ${PROMOTION_MAX_DAYS}일까지 신청할 수 있습니다.`);
  const { session, supabase, tenantId } = await ctx("market.write");
  if (category_code) {
    const { data: cat } = await supabase.from("platform_category").select("code").eq("code", category_code).eq("is_active", true).maybeSingle();
    if (!cat) return fail("없는 분류입니다.");
  }
  const { error } = await supabase
    .from("vendor_promotion")
    .insert({ tenant_id: tenantId, kind, placement, category_code, starts_on, ends_on, note, requested_by: session.user.id });
  if (error) return fail(friendly(error, "상단 노출을 신청할 권한이 없습니다."));
  revalidateMarket("/market/promotions");
  return { ok: "신청했습니다. 집대리 운영자가 금액을 정해 승인하면 알림이 옵니다." };
}

/** 신청 상태의 광고만 취소할 수 있다 (승인·반려 뒤에는 운영자에게 말해야 한다). */
export async function cancelPromotion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("market.write");
  const { error, count } = await supabase
    .from("vendor_promotion")
    .update({ status: "canceled" }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .eq("status", "requested");
  if (error) return fail(friendly(error, "광고를 취소할 권한이 없습니다."));
  if (!count) return fail("신청 상태의 광고만 취소할 수 있습니다.");
  revalidateMarket("/market/promotions");
  return { ok: "취소했습니다." };
}
