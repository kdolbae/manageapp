"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";

const uuid = z.string().uuid();
const optUuid = z.string().uuid().or(z.literal("")).optional().transform((v) => (v ? v : null));
const optText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const money = z
  .string()
  .trim()
  .transform((v) => Number(v.replace(/[^\d-]/g, "") || 0))
  .pipe(z.number().int().min(0).max(9_999_999_999));
const optDate = z.string().trim().optional().transform((v) => (v ? v : null)).pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}
const fail = (message: string): ActionState => ({ error: message });
const friendly = (code: string | undefined, message: string) =>
  code === "42501" ? "권한이 없습니다." : code === "23503" ? "연결된 기록이 있어 처리할 수 없습니다." : message;

// ---------------------------------------------------------------- 계약 등록 (RPC 한 번)
export async function createContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session, supabase, tenantId } = await ctx("contract.write");
  const head = z
    .object({
      customer_id: uuid,
      site_id: optUuid,
      new_site_name: optText(80),
      new_site_address: optText(160),
      new_site_dong: optText(10),
      new_site_ho: optText(10),
      branch_id: optUuid,
      partner_id: optUuid,
      intake_type_code: optText(30),
      contract_date: optDate,
      sales_owner_id: optUuid,
      memo: optText(1000),
    })
    .safeParse(Object.fromEntries(formData));
  if (!head.success) return fail("계약 기본 정보를 확인해 주세요.");
  const h = head.data;

  // 품목: line_<key> 체크 + qty_<key>, price_<key>, discount_<key>, name_<key>, wa_<key>, rate_<key>
  type Line = { product_id: string | null; name: string; work_area_code: string | null; qty: number; unit_price: number; discount: number; technician_rate: number };
  const lines: Line[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("line_") || v !== "on") continue;
    const key = k.slice(5);
    const name = String(formData.get(`name_${key}`) ?? "").trim();
    if (!name) continue;
    const qty = Number(formData.get(`qty_${key}`) || 1);
    const price = money.safeParse(String(formData.get(`price_${key}`) ?? "0"));
    const discount = money.safeParse(String(formData.get(`discount_${key}`) ?? "0"));
    const rate = money.safeParse(String(formData.get(`rate_${key}`) ?? "0"));
    if (!price.success || !discount.success || !rate.success || !(qty > 0)) return fail(`품목 "${name}" 의 수량·금액을 확인해 주세요.`);
    const pid = key.startsWith("p:") ? key.slice(2) : null;
    lines.push({
      product_id: pid && uuid.safeParse(pid).success ? pid : null,
      name,
      work_area_code: String(formData.get(`wa_${key}`) ?? "").trim() || null,
      qty,
      unit_price: price.data,
      discount: discount.data,
      technician_rate: rate.data,
    });
  }
  if (lines.length === 0) return fail("품목을 하나 이상 골라 주세요.");

  // 시공 건: 품목의 작업 단위별로 하나씩. date_<wa>, slot_<wa>, tech_<wa>
  const areas = Array.from(new Set(lines.map((l) => l.work_area_code ?? "")));
  const jobs = areas.map((wa) => {
    const key = wa || "none";
    const tech = String(formData.get(`tech_${key}`) ?? "");
    return {
      work_area_code: wa || null,
      scheduled_date: String(formData.get(`date_${key}`) ?? "") || null,
      time_slot: String(formData.get(`slot_${key}`) ?? "any") || "any",
      technician_id: session.can("job.assign") && uuid.safeParse(tech).success ? tech : null,
    };
  });

  let siteId = h.site_id;
  if (!siteId && h.new_site_name) {
    const { data: site, error } = await supabase
      .from("site")
      .insert({ tenant_id: tenantId, customer_id: h.customer_id, name: h.new_site_name, address: h.new_site_address, dong: h.new_site_dong, ho: h.new_site_ho })
      .select("id")
      .single();
    if (error) return fail(friendly(error.code, error.message));
    siteId = site.id;
  }

  const { data, error } = await supabase.rpc("create_contract", {
    p: {
      tenant_id: tenantId,
      branch_id: h.branch_id,
      customer_id: h.customer_id,
      site_id: siteId,
      partner_id: h.partner_id,
      intake_type_code: h.intake_type_code,
      contract_date: h.contract_date,
      sales_owner_id: h.sales_owner_id ?? session.user.id,
      memo: h.memo,
      lines,
      jobs,
    },
  });
  if (error) return fail(friendly(error.code, error.message));
  revalidatePath("/contracts");
  redirect(`/contracts/${data}`);
}

// ---------------------------------------------------------------- 현장에서 새 고객 바로 등록 → 계약 등록 2단계로
/** 박람회·현장 태블릿용: 이름·전화만으로 고객을 만들고 바로 그 고객의 계약 등록으로 간다. 담당자는 등록한 본인. */
export async function createCustomerForContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(40), phone: optText(30), address: optText(200), branch_id: optUuid })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("고객 이름을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("customer.write");
  const d = parsed.data;
  const { data, error } = await supabase
    .from("customer")
    .insert({ tenant_id: tenantId, created_by: session.user.id, owner_id: session.user.id, branch_id: d.branch_id ?? session.current.branch_id, name: d.name, phone: d.phone, address: d.address })
    .select("id")
    .single();
  if (error) return fail(friendly(error.code, error.message));
  revalidatePath("/people/customers");
  redirect(`/contracts/new?customer=${data.id}`);
}

// ---------------------------------------------------------------- 계약 수정·승인·취소
export async function updateContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, site_id: optUuid, branch_id: optUuid, partner_id: optUuid, intake_type_code: optText(30), contract_date: optDate, sales_owner_id: optUuid, memo: optText(1000) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("contract.write");
  const { id, ...rest } = parsed.data;
  const { error, count } = await supabase
    .from("contract")
    .update({ ...rest, contract_date: rest.contract_date ?? undefined }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("수정 권한이 없거나 계약을 찾지 못했습니다.");
  revalidatePath(`/contracts/${id}`);
  return { ok: "저장했습니다." };
}

export async function setApproval(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, approval_status: z.enum(["approved", "rejected", "pending"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("contract.approve");
  const { error, count } = await supabase
    .from("contract")
    .update({ approval_status: parsed.data.approval_status }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("계약을 찾지 못했습니다.");
  revalidatePath(`/contracts/${parsed.data.id}`);
  revalidatePath("/contracts");
  return { ok: parsed.data.approval_status === "approved" ? "승인했습니다." : parsed.data.approval_status === "rejected" ? "반려했습니다." : "승인대기로 되돌렸습니다." };
}

export async function cancelContract(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, reason: z.string().trim().min(1).max(300) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("취소 사유를 적어 주세요.");
  const { supabase, tenantId } = await ctx("contract.write");
  const { error, count } = await supabase
    .from("contract")
    .update({ canceled_at: new Date().toISOString(), cancel_reason: parsed.data.reason }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("계약을 찾지 못했습니다.");
  await supabase.from("job").update({ status: "canceled" }).eq("contract_id", parsed.data.id).eq("tenant_id", tenantId).in("status", ["undecided", "scheduled", "assigned", "postponed"]);
  revalidatePath(`/contracts/${parsed.data.id}`);
  revalidatePath("/contracts");
  return { ok: "계약을 취소했습니다." };
}

// ---------------------------------------------------------------- 품목
export async function addLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ contract_id: uuid, product_id: optUuid, name: z.string().trim().min(1).max(80), work_area_code: optText(30), qty: z.coerce.number().positive().max(9999), unit_price: money, discount: money, technician_rate: money })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("품목명·수량·금액을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("contract.write");
  const { contract_id, ...rest } = parsed.data;
  const { error } = await supabase.from("contract_line").insert({ tenant_id: tenantId, contract_id, ...rest });
  if (error) return fail(friendly(error.code, error.message));
  revalidatePath(`/contracts/${contract_id}`);
  return { ok: "품목을 추가했습니다." };
}

export async function updateLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, contract_id: uuid, qty: z.coerce.number().positive().max(9999), unit_price: money, discount: money, technician_rate: money, memo: optText(200) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("수량·금액을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("contract.write");
  const { id, contract_id, ...rest } = parsed.data;
  const { error, count } = await supabase.from("contract_line").update(rest, { count: "exact" }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("품목을 찾지 못했습니다.");
  revalidatePath(`/contracts/${contract_id}`);
  return { ok: "저장했습니다." };
}

export async function deleteLine(formData: FormData) {
  const parsed = z.object({ id: uuid, contract_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { supabase, tenantId } = await ctx("contract.write");
  await supabase.from("contract_line").delete().eq("id", parsed.data.id).eq("tenant_id", tenantId);
  revalidatePath(`/contracts/${parsed.data.contract_id}`);
}

// ---------------------------------------------------------------- 시공 건
export async function addJob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ contract_id: uuid, work_area_code: optText(30), kind: z.enum(["install", "as", "repair"]), scheduled_date: optDate, time_slot: z.enum(["any", "am", "pm"]), technician_id: optUuid, memo: optText(300) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("job.write");
  const { contract_id, technician_id, ...rest } = parsed.data;
  const { data: job, error } = await supabase
    .from("job")
    .insert({ tenant_id: tenantId, contract_id, technician_id: session.can("job.assign") ? technician_id : null, ...rest })
    .select("id")
    .single();
  if (error) return fail(friendly(error.code, error.message));
  // 같은 작업 단위 품목과 연결
  const { data: lines } = await supabase.from("contract_line").select("id, work_area_code").eq("contract_id", contract_id);
  const linked = (lines ?? []).filter((l) => !rest.work_area_code || l.work_area_code === rest.work_area_code);
  if (linked.length) await supabase.from("job_line").insert(linked.map((l) => ({ job_id: job.id, line_id: l.id })));
  revalidatePath(`/contracts/${contract_id}`);
  return { ok: "시공 건을 추가했습니다." };
}

export async function updateJob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      id: uuid,
      contract_id: uuid,
      scheduled_date: optDate,
      time_slot: z.enum(["any", "am", "pm"]).optional(),
      technician_id: optUuid,
      status: z.enum(["undecided", "scheduled", "assigned", "in_progress", "done", "postponed", "canceled"]).optional(),
      memo: optText(300),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const session = await requireTenant();
  const supabase = await createClient();
  const { id, contract_id, technician_id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest };
  if (session.can("job.assign")) patch.technician_id = technician_id;
  if (!session.can("job.write")) {
    // 기사 본인: 상태·메모만 (DB 트리거도 같은 규칙을 강제한다)
    for (const k of Object.keys(patch)) if (!["status", "memo"].includes(k)) delete patch[k];
  }
  const { error, count } = await supabase.from("job").update(patch, { count: "exact" }).eq("id", id).eq("tenant_id", session.current.tenant_id);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("수정 권한이 없거나 시공 건을 찾지 못했습니다.");
  revalidatePath(`/contracts/${contract_id}`);
  revalidatePath("/jobs");
  return { ok: "저장했습니다." };
}

export async function removeJob(formData: FormData) {
  const parsed = z.object({ id: uuid, contract_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { supabase, tenantId } = await ctx("job.write");
  await supabase.from("job").update({ deleted_at: new Date().toISOString(), status: "canceled" }).eq("id", parsed.data.id).eq("tenant_id", tenantId);
  revalidatePath(`/contracts/${parsed.data.contract_id}`);
}

// ---------------------------------------------------------------- 원장
export async function addLedgerEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      contract_id: uuid,
      entry_type: z.enum(["deposit", "interim", "balance", "refund", "discount", "voucher", "sales_cancel", "adjust"]),
      amount: money.pipe(z.number().positive()),
      pay_method_code: optText(30),
      occurred_at: optDate,
      job_id: optUuid,
      memo: optText(300),
      receipt_no: optText(50),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("유형과 금액(0보다 큰 값)을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("ledger.write");
  const { contract_id, occurred_at, ...rest } = parsed.data;
  const { error } = await supabase.from("ledger_entry").insert({
    tenant_id: tenantId,
    contract_id,
    ...rest,
    occurred_at: occurred_at ? `${occurred_at}T12:00:00+09:00` : new Date().toISOString(),
    received_by: session.user.id,
  });
  if (error) return fail(friendly(error.code, error.message));
  revalidatePath(`/contracts/${contract_id}`);
  revalidatePath("/ledger");
  return { ok: "기록했습니다." };
}

export async function voidLedgerEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, contract_id: uuid, reason: z.string().trim().min(1).max(200) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("취소 사유를 적어 주세요.");
  const { supabase, tenantId } = await ctx("ledger.void");
  const { error, count } = await supabase
    .from("ledger_entry")
    .update({ voided_at: new Date().toISOString(), void_reason: parsed.data.reason }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("기록을 찾지 못했습니다.");
  revalidatePath(`/contracts/${parsed.data.contract_id}`);
  revalidatePath("/ledger");
  return { ok: "취소했습니다. 잔액은 다시 계산됩니다." };
}
