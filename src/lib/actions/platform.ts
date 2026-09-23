"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import { siteOrigin } from "@/lib/origin";
import { platformContext } from "@/lib/market";
import type { ActionState } from "@/lib/actions/auth";

/* 집대리 플랫폼 운영자 액션. 화면은 platform/layout 이 거르지만, 액션마다 운영자인지 다시 확인한다
 * (DB 의 RLS·트리거·RPC 도 app.is_platform_admin() 으로 같은 조건을 막는다). */

const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const onOff = z.enum(["true", "false"]).transform((v) => v === "true");
/** 사업체 slug 규칙 (tenant.slug check 와 동일) */
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;
/** platform_category.code check 와 동일 */
const CATEGORY_CODE = /^[a-z_]+$/;

/** "1,234,000" · "1234000원" · "-5,000" → 정수. 범위 밖이면 null */
function parseWon(v: string, min: number, nonZero: boolean): number | null {
  const n = Number(v.replace(/[,\s원]/g, ""));
  if (!Number.isInteger(n) || n < min || n > 1e12 || (nonZero && n === 0)) return null;
  return n;
}
const wonHint = (min: number) => (min < 0 ? "0이 아닌 정수(음수는 차감)" : "0원 이상 정수");
/** 필수 금액 */
const won = (label: string, min = 0, nonZero = false) =>
  z.string().trim().transform((v, ctx) => {
    const n = v ? parseWon(v, min, nonZero) : null;
    if (n === null) {
      ctx.addIssue({ code: "custom", message: `${label}: ${wonHint(min)}로 적어 주세요.` });
      return z.NEVER;
    }
    return n;
  });
/** 선택 금액. 비어 있으면 null */
const optWon = (label: string, min = 0) =>
  z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const n = parseWon(v, min, false);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: `${label}: ${wonHint(min)}로 적어 주세요.` });
      return z.NEVER;
    }
    return n;
  });

const fail = (message: string): ActionState => ({ error: message });
const invalid = (error: z.ZodError): ActionState => fail(error.issues.find((i) => i.code === "custom")?.message ?? "입력값을 확인해 주세요.");

/** RLS·트리거가 막으면(42501) 한국어 안내. 트리거가 이미 한국어로 이유를 말했으면 그 말을 그대로 보여준다. */
function friendly(error: { code?: string; message: string }, denied = "권한이 없습니다.") {
  if (error.code === "42501") return /[가-힣]/.test(error.message) ? error.message : denied;
  return error.message;
}

const DENIED = "집대리 운영자만 할 수 있습니다";

/** 운영사 사업체로 접속한 platform.manage 권한자만. 아니면 예외 (화면은 layout 이 이미 404 로 거른다). */
async function ctx() {
  const session = await requireTenant();
  const supabase = await createClient();
  const platform = await platformContext(supabase, session.current.tenant_id, session.can);
  if (!platform.isPlatformAdmin) throw new Error(DENIED);
  return { session, supabase };
}

/** 플랫폼 운영 화면 전체(탭의 대기 건수 포함)를 다시 그린다 */
function revalidatePlatform(...paths: string[]) {
  revalidatePath("/platform", "layout");
  for (const p of paths) revalidatePath(p);
}

// ---------------------------------------------------------------- 운영사 지정
/** 운영사가 아직 없을 때, 현재 사업체를 집대리 운영사로 지정한다 (대표만, 한 번). RPC 가 대표 여부·중복을 다시 확인한다. */
export async function claimOperator(): Promise<ActionState> {
  const session = await requireTenant();
  if (session.current.role.code !== "owner") return fail("사업체 대표만 운영사로 지정할 수 있습니다.");
  const supabase = await createClient();
  const platform = await platformContext(supabase, session.current.tenant_id, session.can);
  if (platform.operatorTenantId) return fail("운영사가 이미 지정되어 있습니다.");
  const { error } = await supabase.rpc("claim_platform_operator", { p_tenant: session.current.tenant_id });
  if (error) return fail(friendly(error, "사업체 대표만 운영사로 지정할 수 있습니다."));
  revalidatePath("/", "layout"); // 메뉴에 '플랫폼 운영'이 나타난다
  revalidatePath("/platform", "layout");
  redirect("/platform");
}

// ---------------------------------------------------------------- 신청 심사
/** 승인: RPC 가 사업체·본사 지점·업체 소개·수수료(기본값)·대표 초대를 만든다. 초대 링크는 신청 카드에서 다시 보인다. */
export async function approveVendor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, slug: z.string().trim().toLowerCase().regex(SLUG) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("업체 주소(slug)는 영문 소문자·숫자·하이픈 2~31자, 첫 글자는 영문·숫자로 적어 주세요.");
  const { supabase } = await ctx();
  const { data, error } = await supabase.rpc("approve_vendor", { p_application: parsed.data.id, p_slug: parsed.data.slug });
  if (error) {
    if (error.code === "23505") return fail("이미 쓰고 있는 업체 주소(slug)입니다. 다른 값으로 바꿔 주세요.");
    return fail(friendly(error, "집대리 운영자만 승인할 수 있습니다."));
  }
  const r = (data ?? {}) as { tenant_id?: string; invitation_token?: string; email?: string };
  revalidatePlatform("/platform/applications", "/platform/vendors");
  const origin = await siteOrigin();
  return { ok: `승인했습니다. 대표 초대 링크(${r.email ?? ""}): ${origin}/invite/${r.invitation_token ?? ""} — 아래에서 복사하거나 메일로 보낼 수 있습니다.` };
}

export async function rejectVendor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, review_note: optText(1000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("반려 사유는 1000자 이내로 적어 주세요.");
  const { session, supabase } = await ctx();
  const { error, count } = await supabase
    .from("vendor_application")
    .update({ status: "rejected", review_note: parsed.data.review_note, reviewed_by: session.user.id, reviewed_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("status", "pending");
  if (error) return fail(friendly(error));
  if (!count) return fail("이미 처리된 신청이거나 찾지 못했습니다.");
  revalidatePlatform("/platform/applications");
  return { ok: "반려했습니다. (신청자에게는 자동으로 알리지 않습니다 — 필요하면 이메일로 안내해 주세요)" };
}

// ---------------------------------------------------------------- 업체 노출 · 수수료
/** 노출 켜기/끄기. listed_at 은 트리거가 채운다. */
export async function setVendorListed(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ tenant_id: uuid, is_listed: onOff }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase } = await ctx();
  const { tenant_id, is_listed } = parsed.data;
  const { error, count } = await supabase.from("vendor_profile").update({ is_listed }, { count: "exact" }).eq("tenant_id", tenant_id);
  if (error) return fail(friendly(error));
  if (!count) return fail("업체 소개를 찾지 못했습니다.");
  revalidatePlatform("/platform/vendors", "/platform/applications");
  return { ok: is_listed ? "노출을 켰습니다. 분류·지역이 맞는 새 요청이 이 업체에도 갑니다." : "노출을 껐습니다. 새 요청은 가지 않고, 이미 낸 견적은 그대로입니다." };
}

const feeInput = z.object({
  tenant_id: uuid,
  fee_type: z.enum(["percent", "fixed", "none"]),
  rate: z.coerce.number().min(0).max(100),
  fixed_amount: optWon("건당 정액"),
  min_fee: optWon("최소 수수료"),
  max_fee: optWon("최대 수수료"),
  cycle: z.enum(["monthly", "per_case"]),
  memo: optText(500),
});

/** 업체별 수수료 설정 (없으면 만든다). 다음 정산서부터 적용된다. */
export async function upsertFee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = feeInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { session, supabase } = await ctx();
  const d = parsed.data;
  if (d.min_fee != null && d.max_fee != null && d.min_fee > d.max_fee) return fail("최소 수수료가 최대 수수료보다 큽니다.");
  const { error } = await supabase
    .from("platform_fee")
    .upsert({ ...d, rate: Math.round(d.rate * 1000) / 1000, fixed_amount: d.fixed_amount ?? 0, updated_by: session.user.id }, { onConflict: "tenant_id" });
  if (error) return fail(friendly(error));
  revalidatePlatform("/platform/vendors");
  return { ok: "수수료 설정을 저장했습니다. 다음에 만드는 정산서부터 적용됩니다." };
}

// ---------------------------------------------------------------- 정산
/** 기간 안 계약일의 플랫폼 계약 수수료 + 기간에 시작한 승인 광고로 정산서(작성 중)를 만들고 그 화면으로 간다. */
export async function buildSettlement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ tenant_id: uuid, period_from: ymd, period_to: ymd }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("업체와 기간(시작일·종료일)을 확인해 주세요.");
  const { tenant_id, period_from, period_to } = parsed.data;
  if (period_from > period_to) return fail("시작일이 종료일보다 늦습니다.");
  const { supabase } = await ctx();
  const { data, error } = await supabase.rpc("build_platform_settlement", { p_tenant: tenant_id, p_from: period_from, p_to: period_to });
  if (error) return fail(friendly(error, "집대리 운영자만 정산서를 만들 수 있습니다."));
  if (!data) return fail("정산서를 만들지 못했습니다.");
  revalidatePlatform("/platform/settlements");
  redirect(`/platform/settlements/${String(data)}`);
}

/** 상태 전이: 작성 중 → 발행 → 입금 완료, 무효는 어디서나. issued_at·paid_at 과 알림은 트리거가 맡는다. */
const SETTLEMENT_FROM: Record<"issued" | "paid" | "void", string[]> = { issued: ["draft"], paid: ["issued"], void: ["draft", "issued", "paid"] };

export async function setSettlementStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, status: z.enum(["issued", "paid", "void"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase } = await ctx();
  const { id, status } = parsed.data;
  const { data: cur } = await supabase.from("platform_settlement").select("status").eq("id", id).maybeSingle();
  if (!cur) return fail("정산서를 찾지 못했습니다.");
  if (!SETTLEMENT_FROM[status].includes(cur.status as string)) return fail("지금 상태에서는 할 수 없는 처리입니다.");
  if (status === "issued") {
    const { count } = await supabase.from("platform_settlement_line").select("id", { count: "exact", head: true }).eq("settlement_id", id);
    if (!count) return fail("정산 항목이 없어 발행할 수 없습니다. 조정 항목을 더하거나 무효 처리해 주세요.");
  }
  const { error, count } = await supabase.from("platform_settlement").update({ status }, { count: "exact" }).eq("id", id);
  if (error) return fail(friendly(error));
  if (!count) return fail("정산서를 바꾸지 못했습니다.");
  revalidatePlatform("/platform/settlements", `/platform/settlements/${id}`, "/platform/promotions");
  return {
    ok:
      status === "issued"
        ? "발행했습니다. 업체의 정산 조회 권한자에게 알림이 갑니다."
        : status === "paid"
          ? "입금 확인으로 기록했습니다."
          : "무효 처리했습니다. 이 정산서에 청구됐던 계약·광고는 다음 정산서에 다시 잡힙니다.",
  };
}

/** 조정 항목(할인·추가 청구). 음수는 차감. 작성 중 정산서에만 — 트리거가 다시 확인하고 합계를 다시 계산한다. */
export async function addAdjustLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ settlement_id: uuid, description: z.string().trim().min(1).max(200), fee_amount: won("금액", -1e12, true) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await ctx();
  const { settlement_id, description, fee_amount } = parsed.data;
  const { data: s } = await supabase.from("platform_settlement").select("tenant_id, status").eq("id", settlement_id).maybeSingle();
  if (!s) return fail("정산서를 찾지 못했습니다.");
  if (s.status !== "draft") return fail("작성 중인 정산서에만 항목을 더할 수 있습니다.");
  const { error } = await supabase
    .from("platform_settlement_line")
    .insert({ settlement_id, tenant_id: s.tenant_id, kind: "adjust", description, basis_amount: 0, fee_amount });
  if (error) return fail(friendly(error));
  revalidatePlatform(`/platform/settlements/${settlement_id}`, "/platform/settlements");
  return { ok: "항목을 더했습니다." };
}

export async function deleteLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, settlement_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase } = await ctx();
  const { id, settlement_id } = parsed.data;
  const { error, count } = await supabase.from("platform_settlement_line").delete({ count: "exact" }).eq("id", id).eq("settlement_id", settlement_id);
  if (error) return fail(friendly(error));
  if (!count) return fail("항목을 찾지 못했습니다.");
  revalidatePlatform(`/platform/settlements/${settlement_id}`, "/platform/settlements");
  return { ok: "항목을 뺐습니다. 뺀 계약·광고는 다음 정산서를 만들 때 다시 잡힙니다." };
}

export async function updateSettlementMemo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, memo: optText(1000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("메모는 1000자 이내로 적어 주세요.");
  const { supabase } = await ctx();
  const { error, count } = await supabase.from("platform_settlement").update({ memo: parsed.data.memo }, { count: "exact" }).eq("id", parsed.data.id);
  if (error) return fail(friendly(error));
  if (!count) return fail("정산서를 찾지 못했습니다.");
  revalidatePlatform(`/platform/settlements/${parsed.data.id}`);
  return { ok: "메모를 저장했습니다." };
}

// ---------------------------------------------------------------- 광고(상단 노출)
/** 승인(금액 확정) 또는 반려. decided_by/at 과 업체 알림은 트리거가 맡는다. 승인된 광고는 시작일이 든 기간의 정산서에 잡힌다. */
export async function decidePromotion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, decision: z.enum(["approved", "rejected"]), price: optWon("광고 금액"), note: optText(500) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { id, decision, price, note } = parsed.data;
  if (decision === "approved" && price === null) return fail("승인하려면 광고 금액을 적어 주세요.");
  const { supabase } = await ctx();
  const patch = decision === "approved" ? { status: "approved", price, note } : { status: "rejected", note };
  const { error, count } = await supabase.from("vendor_promotion").update(patch, { count: "exact" }).eq("id", id).eq("status", "requested");
  if (error) return fail(friendly(error));
  if (!count) return fail("이미 처리된 신청이거나 찾지 못했습니다.");
  revalidatePlatform("/platform/promotions");
  return { ok: decision === "approved" ? "승인했습니다. 업체에 알림이 가고, 시작일이 든 기간의 정산서에 청구됩니다." : "반려했습니다. 업체에 알림이 갑니다." };
}

// ---------------------------------------------------------------- 요청 · 대화
/** 요청 × 업체 대화방에 집대리 이름으로 글을 남긴다 (고객·업체 모두 본다). */
export async function sendPlatformMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ request_id: uuid, tenant_id: uuid, body: z.string().trim().min(1).max(2000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("내용을 2000자 이내로 적어 주세요.");
  const { session, supabase } = await ctx();
  const { request_id, tenant_id, body } = parsed.data;
  const { error } = await supabase.from("request_message").insert({ request_id, tenant_id, sender: "platform", sender_id: session.user.id, body });
  if (error) return fail(friendly(error));
  revalidatePath(`/platform/requests/${request_id}`);
  return { ok: "보냈습니다." };
}

/** 운영자가 요청을 닫는다. 마감(closed)=정상 종료, 취소(canceled)=고객 취소·스팸. closed_at 은 트리거가 채운다. */
export async function closeRequestAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, status: z.enum(["closed", "canceled"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase } = await ctx();
  const { id, status } = parsed.data;
  const { error, count } = await supabase.from("service_request").update({ status }, { count: "exact" }).eq("id", id).in("status", ["open", "accepted"]);
  if (error) return fail(friendly(error));
  if (!count) return fail("이미 닫힌 요청이거나 찾지 못했습니다.");
  revalidatePlatform("/platform/requests", `/platform/requests/${id}`);
  return { ok: status === "closed" ? "요청을 마감했습니다." : "요청을 취소 처리했습니다." };
}

// ---------------------------------------------------------------- 서비스 분류
/** 같은 코드가 있으면 이름·순서를 고친다. 코드는 영문 소문자·밑줄만. */
export async function upsertCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      code: z.string().trim().toLowerCase().min(2).max(40).regex(CATEGORY_CODE),
      label: z.string().trim().min(1).max(40),
      sort_order: z.coerce.number().int().min(0).max(9999).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("코드(영문 소문자·밑줄, 2~40자)와 이름(40자 이내)·순서를 확인해 주세요.");
  const { supabase } = await ctx();
  const { code, label, sort_order } = parsed.data;
  const { error } = await supabase.from("platform_category").upsert({ code, label, sort_order: sort_order ?? 0 }, { onConflict: "code" });
  if (error) return fail(friendly(error));
  revalidatePlatform("/platform/categories");
  return { ok: `분류 '${label}'(${code})을 저장했습니다.` };
}

export async function toggleCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ code: z.string().trim().regex(CATEGORY_CODE), is_active: onOff }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase } = await ctx();
  const { code, is_active } = parsed.data;
  const { error, count } = await supabase.from("platform_category").update({ is_active }, { count: "exact" }).eq("code", code);
  if (error) return fail(friendly(error));
  if (!count) return fail("분류를 찾지 못했습니다.");
  revalidatePlatform("/platform/categories");
  return { ok: is_active ? "다시 사용합니다." : "숨겼습니다. 기존 요청·업체 소개의 분류값은 그대로 남습니다." };
}
