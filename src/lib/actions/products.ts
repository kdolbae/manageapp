"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";
import { APP_SERVICE_IDS } from "@/lib/app-link";

// ---------------------------------------------------------------- 공통 스키마
const MAX_AMOUNT = 99_999_999_999_999; // numeric(14,0)

const uuid = z.string().uuid();
/** select 에서 고르지 않은 값("")은 null. */
const uuidOpt = z
  .string()
  .uuid()
  .or(z.literal(""))
  .optional()
  .transform((v) => v || null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const codeInput = z.string().trim().toUpperCase().regex(/^[A-Z0-9_.-]{1,30}$/);

/** "1,234,000" · "1 234 000원" → "1234000". 빈 값은 undefined 로 넘겨 기본값이 쓰이게 한다. */
function cleanNumber(v: unknown) {
  if (typeof v !== "string") return v;
  const s = v.replace(/[,\s원]/g, "");
  return s === "" ? undefined : s;
}
/** 금액(원, 0 이상 정수). 비우면 0. */
const amount = z.preprocess(cleanNumber, z.coerce.number().int().min(0).max(MAX_AMOUNT).default(0));
/** 금액(필수). */
const amountRequired = z.preprocess(cleanNumber, z.coerce.number().int().min(0).max(MAX_AMOUNT));
/** 금액(선택). 비우면 null. */
const amountOpt = z.preprocess(cleanNumber, z.coerce.number().int().min(0).max(MAX_AMOUNT).nullable().default(null));
/** 가감액(음수 허용). 비우면 0. */
const delta = z.preprocess(cleanNumber, z.coerce.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT).default(0));
/** 정수(정렬 순서·우선순위). 비우면 0. */
const int = z.preprocess(cleanNumber, z.coerce.number().int().min(-1_000_000).max(1_000_000).default(0));
/** 0 이상 정수(선택). 비우면 null. */
const intOpt = z.preprocess(cleanNumber, z.coerce.number().int().min(0).max(1_000_000).nullable().default(null));
/** 수량(0 초과, 소수 둘째 자리까지). 비우면 1. */
const qty = z
  .preprocess(cleanNumber, z.coerce.number().positive().max(99_999_999).default(1))
  .transform((v) => Math.round(v * 100) / 100);
/** <input type="date"> 값. 비우면 null. */
const dateOpt = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .pipe(z.iso.date().nullable());
/** 체크박스: 체크되면 "on", 아니면 값이 아예 없다. */
const flag = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());

// ---------------------------------------------------------------- 컨텍스트·헬퍼
async function ctx() {
  const session = await requireTenant();
  if (!session.can("product.manage")) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

function fail(message: string): ActionState {
  return { error: message };
}

function dbFail(error: { code?: string; message: string }, duplicate?: string): ActionState {
  if (error.code === "23505") return fail(duplicate ?? "같은 값이 이미 있습니다.");
  if (error.code === "42501") return fail("권한이 없습니다.");
  if (error.code === "23503") return fail("연결된 데이터가 있어 처리할 수 없습니다.");
  return fail(error.message);
}

/** 이 사업체의 (보관되지 않은) 상품인지 확인. */
async function findProduct({ supabase, tenantId }: Ctx, id: string) {
  const { data } = await supabase
    .from("product")
    .select("id, kind")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as { id: string; kind: string } | null) ?? null;
}

/** 지점·협력업체·단지·시공자 같은 참조 대상이 이 사업체 것인지 확인. 비어 있으면 통과. */
async function belongs({ supabase, tenantId }: Ctx, table: string, id: string | null) {
  if (!id) return true;
  const { data } = await supabase.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return Boolean(data);
}

/** 상품 목록과 상세 화면을 다시 그리게 한다. */
function touch(productId: string) {
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
}

function periodOk(from: string | null, to: string | null) {
  return !from || !to || from <= to;
}

// ---------------------------------------------------------------- 카테고리
const categoryInput = z.object({
  code: codeInput,
  name: z.string().trim().min(1).max(40),
  sort_order: int,
});

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = categoryInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("카테고리 코드(영문·숫자 1~30자)와 이름을 확인해 주세요.");
  const c = await ctx();
  const { error } = await c.supabase.from("product_category").insert({ tenant_id: c.tenantId, ...parsed.data });
  if (error) return dbFail(error, "같은 코드의 카테고리가 이미 있습니다(보관된 것 포함).");
  revalidatePath("/products/categories");
  revalidatePath("/products");
  return { ok: "카테고리를 추가했습니다." };
}

export async function updateCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = categoryInput
    .omit({ code: true })
    .extend({ id: uuid, status: z.enum(["active", "archived"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const c = await ctx();
  const { id, status, ...rest } = parsed.data;
  const { data } = await c.supabase
    .from("product_category")
    .select("deleted_at")
    .eq("id", id)
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  const current = data as { deleted_at: string | null } | null;
  if (!current) return fail("카테고리를 찾지 못했습니다.");
  let deleted_at: string | null = null;
  if (status === "archived") {
    const { count } = await c.supabase
      .from("product")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id)
      .eq("tenant_id", c.tenantId)
      .is("deleted_at", null);
    if (count) return fail(`상품 ${count}개가 이 카테고리에 있어 보관할 수 없습니다. 먼저 상품의 카테고리를 옮겨 주세요.`);
    deleted_at = current.deleted_at ?? new Date().toISOString();
  }
  const { error } = await c.supabase
    .from("product_category")
    .update({ ...rest, deleted_at })
    .eq("id", id)
    .eq("tenant_id", c.tenantId);
  if (error) return dbFail(error);
  revalidatePath("/products/categories");
  revalidatePath("/products");
  return { ok: "저장했습니다." };
}

// ---------------------------------------------------------------- 상품
const productInput = z.object({
  code: codeInput,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["single", "package", "service"]),
  category_id: uuidOpt,
  work_area_code: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
  unit: z
    .string()
    .trim()
    .max(10)
    .optional()
    .transform((v) => v || "식"),
  price: amount,
  technician_rate: amount,
  duration_min: intOpt,
  description: optionalText(2000),
  app_service_id: z
    .union([z.enum(APP_SERVICE_IDS), z.literal("")])
    .optional()
    .transform((v) => v || null),
});
const PRODUCT_INVALID = "상품 코드(영문·숫자 1~30자), 상품명, 금액(숫자)을 확인해 주세요.";
const PRODUCT_DUPLICATE = "같은 코드의 상품이 이미 있습니다(보관된 것 포함).";

/** 카테고리·작업 단위가 이 사업체의 값인지 확인. */
async function checkProductRefs(
  c: Ctx,
  data: { category_id: string | null; work_area_code: string | null },
): Promise<ActionState | null> {
  if (data.category_id) {
    const { data: cat } = await c.supabase
      .from("product_category")
      .select("id")
      .eq("id", data.category_id)
      .eq("tenant_id", c.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cat) return fail("카테고리를 확인해 주세요.");
  }
  if (data.work_area_code) {
    const { data: cv } = await c.supabase
      .from("code_value")
      .select("id")
      .eq("tenant_id", c.tenantId)
      .eq("domain", "work_area")
      .eq("code", data.work_area_code)
      .maybeSingle();
    if (!cv) return fail("작업 단위를 확인해 주세요.");
  }
  return null;
}

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = productInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(PRODUCT_INVALID);
  const c = await ctx();
  const bad = await checkProductRefs(c, parsed.data);
  if (bad) return bad;
  const { data, error } = await c.supabase
    .from("product")
    .insert({ tenant_id: c.tenantId, ...parsed.data })
    .select("id")
    .single();
  if (error) return dbFail(error, PRODUCT_DUPLICATE);
  revalidatePath("/products");
  revalidatePath("/products/categories");
  redirect(`/products/${(data as { id: string }).id}`);
}

export async function updateProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = productInput
    .extend({ id: uuid, status: z.enum(["active", "inactive"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(PRODUCT_INVALID);
  const c = await ctx();
  const { id, ...rest } = parsed.data;
  const bad = await checkProductRefs(c, rest);
  if (bad) return bad;
  if (rest.kind !== "package") {
    const { count } = await c.supabase
      .from("package_item")
      .select("id", { count: "exact", head: true })
      .eq("package_id", id)
      .eq("tenant_id", c.tenantId);
    if (count) return fail("구성 상품이 있는 패키지는 종류를 바꿀 수 없습니다. 먼저 구성을 비워 주세요.");
  }
  const { error, count } = await c.supabase
    .from("product")
    .update(rest, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", c.tenantId)
    .is("deleted_at", null);
  if (error) return dbFail(error, PRODUCT_DUPLICATE);
  if (!count) return fail("상품을 찾지 못했습니다.");
  touch(id);
  revalidatePath("/products/categories");
  return { ok: "저장했습니다." };
}

/** 보관(soft delete): 목록·계약 등록에서 사라지고 기록은 남는다. */
export async function archiveProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("상품을 찾지 못했습니다.");
  const c = await ctx();
  const { error, count } = await c.supabase
    .from("product")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", c.tenantId)
    .is("deleted_at", null);
  if (error) return dbFail(error);
  if (!count) return fail("상품을 찾지 못했습니다.");
  revalidatePath("/products");
  revalidatePath("/products/categories");
  redirect("/products");
}

// ---------------------------------------------------------------- 옵션
export async function createOptionGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ product_id: uuid, name: z.string().trim().min(1).max(40), required: flag, multi: flag })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("옵션 그룹 이름을 확인해 주세요.");
  const c = await ctx();
  if (!(await findProduct(c, parsed.data.product_id))) return fail("상품을 찾지 못했습니다.");
  const { error } = await c.supabase.from("option_group").insert({ tenant_id: c.tenantId, ...parsed.data });
  if (error) return dbFail(error);
  touch(parsed.data.product_id);
  return { ok: "옵션 그룹을 추가했습니다." };
}

export async function deleteOptionGroup(formData: FormData) {
  const parsed = z.object({ id: uuid, product_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const c = await ctx();
  await c.supabase.from("option_group").delete().eq("id", parsed.data.id).eq("tenant_id", c.tenantId);
  touch(parsed.data.product_id);
}

const optionInput = z.object({
  name: z.string().trim().min(1).max(60),
  price_delta: delta,
  technician_rate_delta: delta,
  is_default: flag,
});
const OPTION_INVALID = "옵션명과 가감액(숫자)을 확인해 주세요.";

export async function createOption(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = optionInput.extend({ group_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(OPTION_INVALID);
  const c = await ctx();
  const { data } = await c.supabase
    .from("option_group")
    .select("product_id")
    .eq("id", parsed.data.group_id)
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  const group = data as { product_id: string } | null;
  if (!group) return fail("옵션 그룹을 찾지 못했습니다.");
  const { error } = await c.supabase.from("product_option").insert({ tenant_id: c.tenantId, ...parsed.data });
  if (error) return dbFail(error);
  touch(group.product_id);
  return { ok: "옵션을 추가했습니다." };
}

export async function updateOption(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = optionInput.extend({ id: uuid, product_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(OPTION_INVALID);
  const c = await ctx();
  const { id, product_id, ...rest } = parsed.data;
  const { error, count } = await c.supabase
    .from("product_option")
    .update(rest, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", c.tenantId);
  if (error) return dbFail(error);
  if (!count) return fail("옵션을 찾지 못했습니다.");
  touch(product_id);
  return { ok: "저장했습니다." };
}

export async function deleteOption(formData: FormData) {
  const parsed = z.object({ id: uuid, product_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const c = await ctx();
  await c.supabase.from("product_option").delete().eq("id", parsed.data.id).eq("tenant_id", c.tenantId);
  touch(parsed.data.product_id);
}

// ---------------------------------------------------------------- 패키지 구성
export async function addPackageItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ package_id: uuid, product_id: uuid, qty, price_override: amountOpt })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("구성 상품과 수량(0보다 큰 숫자)을 확인해 주세요.");
  const { package_id, product_id } = parsed.data;
  if (package_id === product_id) return fail("패키지 자신은 구성에 넣을 수 없습니다.");
  const c = await ctx();
  const [pkg, item] = await Promise.all([findProduct(c, package_id), findProduct(c, product_id)]);
  if (!pkg || pkg.kind !== "package") return fail("패키지 상품을 찾지 못했습니다.");
  if (!item || item.kind === "package") return fail("패키지에는 단품·서비스 상품만 넣을 수 있습니다.");
  const { error } = await c.supabase.from("package_item").insert({ tenant_id: c.tenantId, ...parsed.data });
  if (error) return dbFail(error, "이미 구성에 있는 상품입니다.");
  touch(package_id);
  return { ok: "구성 상품을 추가했습니다." };
}

export async function removePackageItem(formData: FormData) {
  const parsed = z.object({ id: uuid, package_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const c = await ctx();
  await c.supabase.from("package_item").delete().eq("id", parsed.data.id).eq("tenant_id", c.tenantId);
  touch(parsed.data.package_id);
}

// ---------------------------------------------------------------- 가격 규칙
export async function createPriceRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      product_id: uuid,
      branch_id: uuidOpt,
      partner_id: uuidOpt,
      complex_id: uuidOpt,
      valid_from: dateOpt,
      valid_to: dateOpt,
      price: amountOpt,
      technician_rate: amountOpt,
      priority: int,
      memo: optionalText(200),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("금액(숫자)과 기간(날짜)을 확인해 주세요.");
  const d = parsed.data;
  if (d.price === null && d.technician_rate === null) return fail("판매가나 기사비 중 하나는 입력해야 합니다.");
  if (!periodOk(d.valid_from, d.valid_to)) return fail("시작일이 종료일보다 늦습니다.");
  const c = await ctx();
  if (!(await findProduct(c, d.product_id))) return fail("상품을 찾지 못했습니다.");
  const [branchOk, partnerOk, complexOk] = await Promise.all([
    belongs(c, "branch", d.branch_id),
    belongs(c, "partner", d.partner_id),
    belongs(c, "complex", d.complex_id),
  ]);
  if (!branchOk) return fail("지점을 확인해 주세요.");
  if (!partnerOk) return fail("협력업체를 확인해 주세요.");
  if (!complexOk) return fail("단지를 확인해 주세요.");
  const { error } = await c.supabase.from("price_rule").insert({ tenant_id: c.tenantId, ...d });
  if (error) return dbFail(error);
  touch(d.product_id);
  return { ok: "가격 규칙을 추가했습니다." };
}

export async function deletePriceRule(formData: FormData) {
  const parsed = z.object({ id: uuid, product_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const c = await ctx();
  await c.supabase.from("price_rule").delete().eq("id", parsed.data.id).eq("tenant_id", c.tenantId);
  touch(parsed.data.product_id);
}

// ---------------------------------------------------------------- 기사별 단가
export async function createTechnicianRate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ product_id: uuid, technician_id: uuid, rate: amountRequired, valid_from: dateOpt, valid_to: dateOpt })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("기사와 단가(숫자)를 확인해 주세요.");
  const d = parsed.data;
  if (!periodOk(d.valid_from, d.valid_to)) return fail("시작일이 종료일보다 늦습니다.");
  const c = await ctx();
  if (!(await findProduct(c, d.product_id))) return fail("상품을 찾지 못했습니다.");
  if (!(await belongs(c, "technician", d.technician_id))) return fail("시공자를 찾지 못했습니다.");
  const { error } = await c.supabase.from("technician_rate").insert({ tenant_id: c.tenantId, ...d });
  if (error) return dbFail(error, "같은 기사·시작일의 단가가 이미 있습니다.");
  touch(d.product_id);
  return { ok: "기사별 단가를 추가했습니다." };
}

export async function deleteTechnicianRate(formData: FormData) {
  const parsed = z.object({ id: uuid, product_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const c = await ctx();
  await c.supabase.from("technician_rate").delete().eq("id", parsed.data.id).eq("tenant_id", c.tenantId);
  touch(parsed.data.product_id);
}
