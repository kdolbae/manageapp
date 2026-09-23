"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";

const uuid = z.string().uuid();
const optUuid = z.string().uuid().or(z.literal("")).optional().transform((v) => (v ? v : null));
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = z.string().trim().optional().transform((v) => (v ? v : null)).pipe(ymd.nullable());
/** "1,234,000" · "1234000원" 도 받는다. */
const wonNumber = (v: string) => Number(v.replace(/[,\s원]/g, ""));
/** 1원 이상 정수 */
const amount = z.string().trim().transform((v, ctx) => {
  const n = wonNumber(v);
  if (!Number.isInteger(n) || n <= 0 || n > 1e12) {
    ctx.addIssue({ code: "custom", message: "금액은 1원 이상 정수로 적어 주세요." });
    return z.NEVER;
  }
  return n;
});
/** 0원 이상 정수. 비어 있으면 0. */
const amount0 = z.string().trim().transform((v, ctx) => {
  const n = v ? wonNumber(v) : 0;
  if (!Number.isInteger(n) || n < 0 || n > 1e12) {
    ctx.addIssue({ code: "custom", message: "부가세는 0원 이상 정수로 적어 주세요." });
    return z.NEVER;
  }
  return n;
});
const fail = (message: string): ActionState => ({ error: message });
const invalid = (error: z.ZodError): ActionState => fail(error.issues.find((i) => i.code === "custom")?.message ?? "입력값을 확인해 주세요.");
/** 42501: 트리거가 한국어 사유를 붙인 경우(결재 권한·확정 잠금 등) 그대로, 아니면 권한 안내. */
const friendly = (code: string | undefined, message: string) => (code === "42501" ? (/[가-힣]/.test(message) ? message : "권한이 없습니다.") : message);

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

function revalidateExpenses() {
  revalidatePath("/finance");
  revalidatePath("/finance/expenses");
}

function revalidatePayout(id?: string) {
  revalidatePath("/finance/payouts");
  if (id) revalidatePath(`/finance/payouts/${id}`);
}

const EDITABLE_EXPENSE = ["draft", "submitted", "rejected"];

// ---------------------------------------------------------------- 경비
export async function createExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      category_code: z.string().trim().min(1).max(40),
      amount,
      vat: amount0.optional(),
      vat_included: z.enum(["on"]).optional(),
      occurred_on: ymd,
      vendor: optText(80),
      memo: optText(500),
      pay_method_code: optText(40),
      branch_id: optUuid,
      contract_id: optUuid,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { session, supabase, tenantId } = await ctx("expense.write");
  const { vat_included, vat, branch_id, ...rest } = parsed.data;
  const vatValue = vat_included ? Math.round(rest.amount / 11) : (vat ?? 0);
  if (vatValue > rest.amount) return fail("부가세가 금액보다 큽니다.");
  const { error } = await supabase.from("expense").insert({
    tenant_id: tenantId,
    branch_id: branch_id ?? session.current.branch_id,
    ...rest,
    vat: vatValue,
    status: "submitted",
    created_by: session.user.id,
  });
  if (error) return fail(friendly(error.code, error.message));
  revalidateExpenses();
  return { ok: "경비를 청구했습니다." };
}

/** 청구자 본인(임시·청구됨·반려)이나 결재자가 고친다. 보낸 항목만 바꾼다. */
export async function updateExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      id: uuid,
      category_code: z.string().trim().min(1).max(40).optional(),
      amount: amount.optional(),
      vat: amount0.optional(),
      occurred_on: ymd.optional(),
      vendor: optText(80),
      memo: optText(500),
      pay_method_code: optText(40),
      branch_id: optUuid,
      status: z.enum(["draft", "submitted"]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const session = await requireTenant();
  if (!session.can("expense.write") && !session.can("expense.approve")) return fail("권한이 없습니다.");
  const supabase = await createClient();
  const { id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && formData.has(k)) patch[k] = v;
  if (Object.keys(patch).length === 0) return fail("바꿀 내용이 없습니다.");
  if (typeof patch.vat === "number" && typeof patch.amount === "number" && patch.vat > patch.amount) return fail("부가세가 금액보다 큽니다.");
  if (patch.status === "submitted") patch.reject_reason = null;
  const { error, count } = await supabase.from("expense").update(patch, { count: "exact" }).eq("id", id).eq("tenant_id", session.current.tenant_id).is("deleted_at", null);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("경비를 찾지 못했거나 고칠 수 없는 상태입니다.");
  revalidateExpenses();
  return { ok: patch.status === "submitted" ? "다시 청구했습니다." : "저장했습니다." };
}

/** 결재: 승인 · 반려(사유) · 지급 */
export async function decideExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, status: z.enum(["approved", "rejected", "paid"]), reject_reason: optText(300) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, tenantId } = await ctx("expense.approve");
  const { id, status, reject_reason } = parsed.data;
  if (status === "rejected" && !reject_reason) return fail("반려 사유를 적어 주세요.");
  const { data: cur } = await supabase.from("expense").select("status").eq("id", id).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle();
  if (!cur) return fail("경비를 찾지 못했거나 내 범위 밖입니다.");
  if (cur.status === "paid") return fail("이미 지급된 경비입니다.");
  if (status === "paid" && cur.status !== "approved") return fail("승인된 경비만 지급 처리할 수 있습니다.");
  if (status === cur.status) return fail("이미 그 상태입니다.");
  const { error, count } = await supabase
    .from("expense")
    .update({ status, reject_reason: status === "rejected" ? reject_reason : null }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("경비를 찾지 못했거나 내 범위 밖입니다.");
  revalidateExpenses();
  return { ok: status === "approved" ? "승인했습니다." : status === "rejected" ? "반려했습니다." : "지급 처리했습니다." };
}

/** 지우기(deleted_at): 본인의 임시·청구됨·반려 경비, 또는 결재자 */
export async function deleteExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const session = await requireTenant();
  const supabase = await createClient();
  const tenantId = session.current.tenant_id;
  const { data: cur } = await supabase.from("expense").select("status, created_by").eq("id", parsed.data.id).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle();
  if (!cur) return fail("경비를 찾지 못했습니다.");
  const mine = cur.created_by === session.user.id && EDITABLE_EXPENSE.includes(cur.status);
  if (!mine && !session.can("expense.approve")) return fail("결재 전이거나 반려된 내 경비만 지울 수 있습니다.");
  const { error, count } = await supabase
    .from("expense")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("지우지 못했습니다. 권한을 확인해 주세요.");
  revalidateExpenses();
  return { ok: "지웠습니다." };
}

// ---------------------------------------------------------------- 기사 정산
/** 기간 안에 완료된 시공 건의 기사비를 모아 정산서를 만든다 (build_payout RPC) */
export async function buildPayout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ technician_id: uuid, from: ymd, to: ymd }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("시공자와 기간을 확인해 주세요.");
  if (parsed.data.from > parsed.data.to) return fail("시작일이 종료일보다 늦습니다.");
  const { supabase, tenantId } = await ctx("payout.approve");
  const { data, error } = await supabase.rpc("build_payout", {
    p_tenant: tenantId,
    p_technician: parsed.data.technician_id,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  });
  if (error) return fail(friendly(error.code, error.message));
  if (!data) return fail("정산서를 만들지 못했습니다.");
  revalidatePayout();
  redirect(`/finance/payouts/${String(data)}`);
}

/** 작성 중 → 확정 → 지급. 확정은 작성 중으로 되돌릴 수 있고, 지급은 되돌리지 못한다(트리거). */
export async function setPayoutStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, status: z.enum(["draft", "confirmed", "paid"]), pay_method_code: optText(40), memo: optText(500) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, tenantId } = await ctx("payout.approve");
  const { id, status, pay_method_code, memo } = parsed.data;
  const { data: cur } = await supabase.from("payout").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!cur) return fail("정산서를 찾지 못했거나 내 범위 밖입니다.");
  const allowed = (status === "confirmed" && cur.status === "draft") || (status === "paid" && cur.status === "confirmed") || (status === "draft" && cur.status === "confirmed");
  if (!allowed) return fail("지금 상태에서는 할 수 없는 처리입니다.");
  if (status === "confirmed") {
    const { count } = await supabase.from("payout_line").select("id", { count: "exact", head: true }).eq("payout_id", id).eq("tenant_id", tenantId);
    if (!count) return fail("정산 줄이 없어 확정할 수 없습니다.");
  }
  const patch: Record<string, unknown> = { status };
  if (formData.has("pay_method_code")) patch.pay_method_code = pay_method_code;
  if (formData.has("memo")) patch.memo = memo;
  const { error, count } = await supabase.from("payout").update(patch, { count: "exact" }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("정산서를 찾지 못했거나 내 범위 밖입니다.");
  revalidatePayout(id);
  return { ok: status === "confirmed" ? "정산서를 확정했습니다." : status === "paid" ? "지급 완료로 기록했습니다." : "작성 중으로 되돌렸습니다." };
}

/** 작성 중인 정산서만 지운다(줄도 함께). */
export async function deletePayout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, tenantId } = await ctx("payout.approve");
  const { data: cur } = await supabase.from("payout").select("status").eq("id", parsed.data.id).eq("tenant_id", tenantId).maybeSingle();
  if (!cur) return fail("정산서를 찾지 못했습니다.");
  if (cur.status !== "draft") return fail("작성 중인 정산서만 지울 수 있습니다.");
  const { error, count } = await supabase.from("payout").delete({ count: "exact" }).eq("id", parsed.data.id).eq("tenant_id", tenantId).eq("status", "draft");
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("지우지 못했습니다. 권한을 확인해 주세요.");
  revalidatePayout();
  redirect("/finance/payouts");
}

/** 일당·추가·공제 줄 더하기 (공제는 음수로 저장) */
export async function addPayoutLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ payout_id: uuid, kind: z.enum(["daily", "extra", "deduct"]), amount, memo: optText(200), work_on: optDate })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, tenantId } = await ctx("payout.approve");
  const { payout_id, kind, memo, work_on } = parsed.data;
  const { error } = await supabase.from("payout_line").insert({
    tenant_id: tenantId,
    payout_id,
    kind,
    amount: kind === "deduct" ? -parsed.data.amount : parsed.data.amount,
    memo,
    work_on,
  });
  if (error) return fail(friendly(error.code, error.message));
  revalidatePayout(payout_id);
  return { ok: "줄을 더했습니다." };
}

export async function removePayoutLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, payout_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, tenantId } = await ctx("payout.approve");
  const { error, count } = await supabase
    .from("payout_line")
    .delete({ count: "exact" })
    .eq("id", parsed.data.id)
    .eq("payout_id", parsed.data.payout_id)
    .eq("tenant_id", tenantId);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("줄을 찾지 못했습니다.");
  revalidatePayout(parsed.data.payout_id);
  return { ok: "줄을 뺐습니다." };
}
