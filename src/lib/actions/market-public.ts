"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/actions/auth";
import { REGIONS } from "@/lib/market";

/** 집대리 마켓 공개 페이지(로그인 없음)의 서버 액션. 모두 서비스 키 RPC 로 처리한다 */

const UNAVAILABLE = "지금은 처리할 수 없습니다. 잠시 뒤 다시 시도해 주세요.";
const fail = (message: string): ActionState => ({ error: message });

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optNum = (max: number) => z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(0).max(max).optional());
const optDate = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional().transform((v) => (v ? v : null));
const optSlug = z.string().trim().toLowerCase().regex(/^([a-z0-9][a-z0-9-]{1,30})?$/).optional().transform((v) => (v ? v : null));
const phoneInput = z.string().trim().max(30).refine((v) => v.replace(/\D/g, "").length >= 8);
const token = z.string().regex(/^[a-zA-Z0-9]{16,64}$/);
const codes = z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(20);
const utmFields = { utm_source: optText(100), utm_medium: optText(100), utm_campaign: optText(100), utm_term: optText(100), utm_content: optText(100), referrer: optText(300), source_page: optText(300) };

/** 체크박스처럼 여러 값이 오는 항목 */
function values(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === "string");
}

/** 검증 실패 → 첫 문제 항목 이름으로 안내 */
function issueMessage(err: z.ZodError, labels: Record<string, string>, fallback: string): string {
  const key = String(err.issues[0]?.path?.[0] ?? "");
  return labels[key] ? `${labels[key]} 항목을 확인해 주세요.` : fallback;
}

/** DB 오류 → 고객용 문구. 42501 은 토큰·상태 오류(함수가 한국어 사유를 주면 그대로 보여준다) */
function dbMessage(error: { code?: string; message?: string }, generic: string): string {
  if (error.code === "42501") return /[가-힣]/.test(error.message ?? "") ? String(error.message) : "링크가 올바르지 않습니다.";
  if (error.code === "22023") return "입력값을 확인해 주세요.";
  return generic;
}

/** 알림 발송(Teams)은 시간마다 도는 배치가 처리한다. 바로 보내고 싶으면 여기서 한 번 시도한다 */
async function tryDeliver(admin: SupabaseClient) {
  try {
    const { deliverPending } = await import("@/lib/notify/deliver");
    const { siteOrigin } = await import("@/lib/origin");
    await deliverPending(admin, { limit: 5, siteUrl: await siteOrigin() });
  } catch {
    /* 발송 실패는 배치가 다시 시도한다 */
  }
}

// ---------------------------------------------------------------------------------------------
// 협력업체 신청
// ---------------------------------------------------------------------------------------------
const applyInput = z.object({
  name: z.string().trim().min(1).max(60),
  business_no: optText(20),
  ceo_name: optText(40),
  phone: phoneInput,
  email: z.string().trim().toLowerCase().max(120).pipe(z.email()),
  address: optText(200),
  regions: z.array(z.enum(REGIONS)).max(REGIONS.length),
  categories: codes,
  intro: optText(1000),
  website: optText(200),
  slug_wanted: optSlug,
  website_url: optText(200), // 허니팟
});
const APPLY_LABELS: Record<string, string> = { name: "상호", phone: "전화", email: "이메일", categories: "서비스 분류", intro: "소개", slug_wanted: "주소 이름", website: "홈페이지" };
const APPLY_DONE: ActionState = { ok: "신청을 받았습니다. 심사 후 이메일로 초대 링크를 보내드립니다." };

export async function applyVendor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = applyInput.safeParse({
    ...Object.fromEntries(formData),
    regions: values(formData, "regions").filter((r) => (REGIONS as readonly string[]).includes(r)),
    categories: values(formData, "categories"),
  });
  if (!parsed.success) return fail(issueMessage(parsed.error, APPLY_LABELS, "상호·전화·이메일과 서비스 분류(1개 이상)를 확인해 주세요."));
  const d = parsed.data;
  if (d.website_url) return APPLY_DONE; // 허니팟: 봇은 조용히 무시
  const admin = createAdminClient();
  if (!admin) return fail("지금은 신청을 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
  const { error } = await admin.rpc("vendor_apply", {
    p: { name: d.name, business_no: d.business_no, ceo_name: d.ceo_name, phone: d.phone, email: d.email, address: d.address, regions: d.regions, categories: d.categories, intro: d.intro, website: d.website, slug_wanted: d.slug_wanted },
  });
  if (error) return fail(dbMessage(error, "신청을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요."));
  return APPLY_DONE;
}

// ---------------------------------------------------------------------------------------------
// 고객 견적 요청 → 비밀 링크(/r/<token>)로 이동
// ---------------------------------------------------------------------------------------------
const requestInput = z.object({
  name: z.string().trim().min(1).max(60),
  phone: phoneInput,
  region_main: z.enum(REGIONS),
  region_detail: optText(40),
  apt: optText(100),
  address: optText(200),
  area_pyeong: optNum(999),
  move_in_date: optDate,
  categories: codes,
  message: optText(2000),
  budget: optNum(1_000_000_000_000),
  vendor_slug: optSlug,
  website: optText(200), // 허니팟
  ...utmFields,
});
const REQUEST_LABELS: Record<string, string> = { name: "이름", phone: "전화", region_main: "지역", categories: "원하는 시공", area_pyeong: "평형", move_in_date: "입주 예정일", budget: "예산", message: "요청 내용" };

export async function createRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = requestInput.safeParse({ ...Object.fromEntries(formData), categories: values(formData, "categories") });
  if (!parsed.success) return fail(issueMessage(parsed.error, REQUEST_LABELS, "이름·전화·지역과 원하는 시공(1개 이상)을 확인해 주세요."));
  const d = parsed.data;
  if (d.website) return { ok: "접수되었습니다." }; // 허니팟: 봇은 조용히 무시
  const admin = createAdminClient();
  if (!admin) return fail("지금은 요청을 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer", "source_page"] as const) if (d[k]) utm[k] = String(d[k]);
  const { data, error } = await admin.rpc("request_create", {
    p: {
      name: d.name,
      phone: d.phone,
      region: [d.region_main, d.region_detail].filter(Boolean).join(" "),
      apt: d.apt,
      address: d.address,
      area_pyeong: d.area_pyeong ?? null,
      move_in_date: d.move_in_date,
      categories: d.categories,
      message: d.message,
      budget: d.budget ?? null,
      vendor_slug: d.vendor_slug,
      utm,
    },
  });
  if (error) return fail(dbMessage(error, "요청을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요."));
  const tok = (data as { token?: string } | null)?.token;
  if (!tok) return fail("요청을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  await tryDeliver(admin);
  redirect(`/r/${tok}`);
}

// ---------------------------------------------------------------------------------------------
// 고객 요청 페이지: 견적 선택 · 대화 · 연락처 공개 · 마감
// ---------------------------------------------------------------------------------------------
export async function acceptQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ token, quote_id: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("링크가 올바르지 않습니다.");
  const admin = createAdminClient();
  if (!admin) return fail(UNAVAILABLE);
  const { error } = await admin.rpc("request_accept", { p_token: parsed.data.token, p_quote: parsed.data.quote_id });
  if (error) return fail(dbMessage(error, "선택을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요."));
  revalidatePath(`/r/${parsed.data.token}`);
  return { ok: "업체를 선택했습니다. 아래 대화로 일정을 정하세요." };
}

export async function sendCustomerMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ token, tenant_id: z.uuid(), body: z.string().trim().min(1).max(2000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("메시지 내용을 적어 주세요.");
  const admin = createAdminClient();
  if (!admin) return fail(UNAVAILABLE);
  const { error } = await admin.rpc("request_customer_message", { p_token: parsed.data.token, p_tenant: parsed.data.tenant_id, p_body: parsed.data.body });
  if (error) return fail(dbMessage(error, "메시지를 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요."));
  await tryDeliver(admin);
  revalidatePath(`/r/${parsed.data.token}`);
  return { ok: "보냈습니다." };
}

export async function sharePhone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ token, share: z.enum(["0", "1"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("링크가 올바르지 않습니다.");
  const admin = createAdminClient();
  if (!admin) return fail(UNAVAILABLE);
  const share = parsed.data.share === "1";
  const { error } = await admin.rpc("request_share_phone", { p_token: parsed.data.token, p_share: share });
  if (error) return fail(dbMessage(error, "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요."));
  revalidatePath(`/r/${parsed.data.token}`);
  return { ok: share ? "선택한 업체에 전화번호를 공개했습니다." : "전화번호 공개를 껐습니다." };
}

export async function closeRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ token }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("링크가 올바르지 않습니다.");
  const admin = createAdminClient();
  if (!admin) return fail(UNAVAILABLE);
  const { error } = await admin.rpc("request_close", { p_token: parsed.data.token });
  if (error) return fail(dbMessage(error, "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요."));
  revalidatePath(`/r/${parsed.data.token}`);
  return { ok: "요청을 마감했습니다." };
}
