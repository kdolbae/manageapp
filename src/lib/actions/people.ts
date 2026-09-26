"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireTenant, type TenantSession } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";

// ---------------------------------------------------------------- 공통
type Db = Awaited<ReturnType<typeof createClient>>;

const uuid = z.string().uuid();
const status = z.enum(["active", "inactive"]);
/** 빈 값은 null. 전화번호는 어떤 형식이든 받는다(DB 트리거가 숫자만 남긴다). */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const optionalUuid = z
  .string()
  .uuid()
  .or(z.literal(""))
  .optional()
  .transform((v) => (v ? v : null));
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(""))
  .optional()
  .transform((v) => (v ? v : null));
const optionalEmail = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!z.email().safeParse(v).success) {
      ctx.addIssue({ code: "custom", message: "이메일 형식이 올바르지 않습니다." });
      return z.NEVER;
    }
    return v;
  });
const optionalRate = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      ctx.addIssue({ code: "custom", message: "수수료율은 0~100 사이 숫자여야 합니다." });
      return z.NEVER;
    }
    return Math.round(n * 1000) / 1000;
  });
/** 체크박스로 고른 코드 목록(작업 단위·협력업체 유형) */
const codeList = z.array(z.string().trim().min(1).max(40)).max(30);
/** 쉼표로 나눈 태그 */
const tags = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) =>
    v
      ? Array.from(
          new Set(
            v
              .split(/[,，]/)
              .map((t) => t.trim().slice(0, 30))
              .filter(Boolean),
          ),
        ).slice(0, 20)
      : [],
  );

/** 폼 값을 객체로. multi 는 체크박스처럼 여러 값을 배열로, flags 는 체크 여부를 불리언으로 받는다. */
function fields(formData: FormData, multi: string[] = [], flags: string[] = []) {
  const obj: Record<string, unknown> = Object.fromEntries(formData);
  for (const k of multi) obj[k] = formData.getAll(k).filter((v): v is string => typeof v === "string");
  for (const k of flags) obj[k] = formData.get(k) === "on";
  return obj;
}

/** 우리가 적은 한국어 메시지면 그대로, zod 기본(영문) 메시지면 대체 문구로. */
function issueMessage(error: z.ZodError, fallback: string) {
  const m = error.issues[0]?.message;
  return m && /[가-힣]/.test(m) ? m : fallback;
}

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

function fail(message: string): ActionState {
  return { error: message };
}

/** Supabase 오류를 한국어로. */
function dbMessage(error: { code?: string; message: string }, duplicate = "같은 값이 이미 있습니다.") {
  switch (error.code) {
    case "42501":
      return "권한이 없거나 내 범위(지점·담당) 밖입니다.";
    case "23505":
      return duplicate;
    case "23503":
      return "연결하려는 항목(지점·담당자·협력업체·단지)을 찾지 못했습니다.";
    default:
      return error.message;
  }
}

// ---------------------------------------------------------------- 고객
const customerInput = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요.").max(40, "이름은 40자까지입니다."),
  phone: text(30),
  phone2: text(30),
  email: optionalEmail,
  address: text(200),
  source_code: text(40),
  referrer_partner_id: optionalUuid,
  branch_id: optionalUuid,
  owner_id: optionalUuid,
  marketing_consent: z.boolean(),
  memo: text(2000),
});

/** 본인 범위(own) 사용자는 담당자를 본인으로만 둘 수 있다(RLS 와 같은 규칙). */
function ownScope<T extends { owner_id: string | null }>(session: TenantSession, data: T): T {
  if (session.current.scope === "own") data.owner_id = session.user.id;
  return data;
}

export async function createCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = customerInput.safeParse(fields(formData, [], ["marketing_consent"]));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요."));
  const { session, supabase, tenantId } = await ctx("customer.write");
  const { data, error } = await supabase
    .from("customer")
    .insert({ tenant_id: tenantId, created_by: session.user.id, ...ownScope(session, parsed.data) })
    .select("id")
    .single();
  if (error) return fail(dbMessage(error));
  revalidatePath("/people/customers");
  redirect(`/people/customers/${String(data.id)}`);
}

export async function updateCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = customerInput.extend({ id: uuid, tags }).safeParse(fields(formData, [], ["marketing_consent"]));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요."));
  const { session, supabase, tenantId } = await ctx("customer.write");
  const { id, ...rest } = parsed.data;
  const { error, count } = await supabase
    .from("customer")
    .update(ownScope(session, rest), { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(dbMessage(error));
  if (!count) return fail("고객을 찾지 못했거나 내 범위 밖입니다.");
  revalidatePath("/people/customers");
  revalidatePath(`/people/customers/${id}`);
  return { ok: "저장했습니다." };
}

/** 보관(soft delete). 목록·검색에서 사라지지만 데이터는 남는다. */
export async function archiveCustomer(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase, tenantId } = await ctx("customer.write");
  await supabase
    .from("customer")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  revalidatePath("/people/customers");
  redirect("/people/customers");
}

// ---------------------------------------------------------------- 현장
const siteInput = z.object({
  customer_id: uuid,
  complex_id: optionalUuid,
  name: text(80),
  address: text(200),
  dong: text(20),
  ho: text(20),
  unit_type: text(30),
  move_in_date: optionalDate,
  memo: text(2000),
});

/** 단지를 골랐고 이름이 비었으면 단지명을 현장 이름으로 쓴다. */
async function resolveSiteName(
  supabase: Db,
  tenantId: string,
  data: { name: string | null; complex_id: string | null },
): Promise<{ name: string } | { error: string }> {
  let name = data.name;
  if (data.complex_id) {
    const { data: cx } = await supabase
      .from("complex")
      .select("name")
      .eq("id", data.complex_id)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cx) return { error: "단지를 찾지 못했습니다." };
    if (!name) name = String(cx.name);
  }
  if (!name) return { error: "현장 이름을 입력하거나 단지를 골라 주세요." };
  return { name };
}

export async function createSite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = siteInput.safeParse(fields(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요 (입주일은 YYYY-MM-DD)."));
  const { supabase, tenantId } = await ctx("customer.write");
  const { data: customer } = await supabase
    .from("customer")
    .select("id")
    .eq("id", parsed.data.customer_id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!customer) return fail("고객을 찾지 못했거나 내 범위 밖입니다.");
  const named = await resolveSiteName(supabase, tenantId, parsed.data);
  if ("error" in named) return fail(named.error);
  const { error } = await supabase.from("site").insert({ tenant_id: tenantId, ...parsed.data, name: named.name });
  if (error) return fail(dbMessage(error));
  revalidatePath(`/people/customers/${parsed.data.customer_id}`);
  revalidatePath("/people/customers");
  return { ok: "현장을 추가했습니다." };
}

export async function updateSite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = siteInput.extend({ id: uuid }).safeParse(fields(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요 (입주일은 YYYY-MM-DD)."));
  const { supabase, tenantId } = await ctx("customer.write");
  const { id, customer_id, ...rest } = parsed.data;
  const named = await resolveSiteName(supabase, tenantId, rest);
  if ("error" in named) return fail(named.error);
  const { error, count } = await supabase
    .from("site")
    .update({ ...rest, name: named.name }, { count: "exact" })
    .eq("id", id)
    .eq("customer_id", customer_id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(dbMessage(error));
  if (!count) return fail("현장을 찾지 못했거나 내 범위 밖입니다.");
  revalidatePath(`/people/customers/${customer_id}`);
  return { ok: "저장했습니다." };
}

export async function deleteSite(formData: FormData) {
  const parsed = z
    .object({ id: uuid, customer_id: uuid })
    .safeParse({ id: formData.get("id"), customer_id: formData.get("customer_id") });
  if (!parsed.success) return;
  const { supabase, tenantId } = await ctx("customer.write");
  await supabase
    .from("site")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("customer_id", parsed.data.customer_id)
    .eq("tenant_id", tenantId);
  revalidatePath(`/people/customers/${parsed.data.customer_id}`);
  revalidatePath("/people/customers");
}

// ---------------------------------------------------------------- 시공자
const technicianInput = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요.").max(40, "이름은 40자까지입니다."),
  phone: text(30),
  branch_id: optionalUuid,
  profile_id: optionalUuid,
  skills: codeList,
  rate_type: z.enum(["rate_3_3", "daily", "invoice"]),
  vehicle_no: text(20),
  hire_date: optionalDate,
  memo: text(2000),
});
const bankInput = z.object({ bank_name: text(30), bank_account: text(40), bank_holder: text(40) });
const DUP_PROFILE = "그 계정은 이미 다른 시공자에 연결돼 있습니다.";

export async function createTechnician(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = technicianInput.safeParse(fields(formData, ["skills"]));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요 (입사일은 YYYY-MM-DD)."));
  const { supabase, tenantId } = await ctx("technician.write");
  const { error } = await supabase.from("technician").insert({ tenant_id: tenantId, ...parsed.data });
  if (error) return fail(dbMessage(error, DUP_PROFILE));
  revalidatePath("/people/technicians");
  return { ok: "시공자를 등록했습니다." };
}

export async function updateTechnician(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = technicianInput.extend({ id: uuid, status }).safeParse(fields(formData, ["skills"]));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요 (입사일은 YYYY-MM-DD)."));
  const { session, supabase, tenantId } = await ctx("technician.write");
  const { id, ...rest } = parsed.data;
  const { data: current } = await supabase
    .from("technician")
    .select("profile_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) return fail("시공자를 찾지 못했거나 내 범위 밖입니다.");
  // 계좌는 정산 조회 권한자와 본인만 고칠 수 있다. 폼에 계좌 칸이 없었으면 건드리지 않는다.
  let bank: Partial<z.infer<typeof bankInput>> = {};
  const bankAllowed = session.can("payout.read") || current.profile_id === session.user.id;
  if (formData.has("bank_account") && bankAllowed) {
    const b = bankInput.safeParse(fields(formData));
    if (!b.success) return fail("계좌 정보를 확인해 주세요.");
    bank = b.data;
  }
  const { error, count } = await supabase
    .from("technician")
    .update({ ...rest, ...bank }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(dbMessage(error, DUP_PROFILE));
  if (!count) return fail("시공자를 찾지 못했거나 내 범위 밖입니다.");
  revalidatePath("/people/technicians");
  revalidatePath(`/people/technicians/${id}`);
  return { ok: "저장했습니다." };
}

// ---------------------------------------------------------------- 협력업체
const partnerInput = z.object({
  name: z.string().trim().min(1, "업체명을 입력해 주세요.").max(80, "업체명은 80자까지입니다."),
  types: codeList,
  business_no: text(20),
  ceo_name: text(40),
  phone: text(30),
  email: optionalEmail,
  address: text(200),
  contact_name: text(40),
  contact_phone: text(30),
  commission_rate: optionalRate,
  settlement_terms: text(500),
  memo: text(2000),
  branch_id: optionalUuid,
});

export async function createPartner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = partnerInput.safeParse(fields(formData, ["types"]));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요."));
  const { supabase, tenantId } = await ctx("partner.write");
  const { error } = await supabase.from("partner").insert({ tenant_id: tenantId, ...parsed.data });
  if (error) return fail(dbMessage(error));
  revalidatePath("/people/partners");
  return { ok: "협력업체를 등록했습니다." };
}

export async function updatePartner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = partnerInput.extend({ id: uuid, status }).safeParse(fields(formData, ["types"]));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요."));
  const { supabase, tenantId } = await ctx("partner.write");
  const { id, ...rest } = parsed.data;
  const { error, count } = await supabase
    .from("partner")
    .update(rest, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(dbMessage(error));
  if (!count) return fail("협력업체를 찾지 못했거나 내 범위 밖입니다.");
  revalidatePath("/people/partners");
  revalidatePath(`/people/partners/${id}`);
  return { ok: "저장했습니다." };
}
