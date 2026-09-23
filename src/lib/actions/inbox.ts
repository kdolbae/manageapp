"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";

const uuid = z.string().uuid();
const optUuid = z.string().uuid().or(z.literal("")).optional().transform((v) => (v ? v : null));
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const fail = (message: string): ActionState => ({ error: message });

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

export async function createInquiry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ channel: z.enum(["web", "phone", "kakao", "partner", "walk_in", "fair", "app", "other"]), name: optText(60), phone: optText(30), kind: optText(60), apt: optText(100), address: optText(200), message: optText(4000), branch_id: optUuid })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  if (!parsed.data.name && !parsed.data.phone) return fail("이름이나 전화번호는 있어야 합니다.");
  const { session, supabase, tenantId } = await ctx("inquiry.write");
  const { data, error } = await supabase.from("inquiry").insert({ tenant_id: tenantId, ...parsed.data, assigned_to: session.user.id }).select("id").single();
  if (error) return fail(error.message);
  revalidatePath("/inbox");
  redirect(`/inbox/${data.id}`);
}

export async function updateInquiry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, status: z.enum(["new", "contacted", "quoted", "converted", "closed", "spam"]).optional(), assigned_to: optUuid, branch_id: optUuid, kind: optText(60), apt: optText(100), address: optText(200), name: optText(60), phone: optText(30) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("inquiry.write");
  const { id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && formData.has(k)) patch[k] = v;
  const { error, count } = await supabase.from("inquiry").update(patch, { count: "exact" }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail(error.message);
  if (!count) return fail("문의를 찾지 못했거나 권한이 없습니다.");
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${id}`);
  return { ok: "저장했습니다." };
}

export async function addConsultation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ inquiry_id: optUuid, customer_id: optUuid, contract_id: optUuid, channel: z.enum(["call", "sms", "kakao", "visit", "email", "memo"]), direction: z.enum(["in", "out"]), summary: z.string().trim().min(1).max(2000), next_action: optText(200), next_action_at: optText(30) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("상담 내용을 적어 주세요.");
  const session = await requireTenant();
  if (!session.can("inquiry.write") && !session.can("customer.write")) return fail("권한이 없습니다.");
  const supabase = await createClient();
  const { next_action_at, ...rest } = parsed.data;
  const { error } = await supabase.from("consultation").insert({ tenant_id: session.current.tenant_id, actor_id: session.user.id, next_action_at: next_action_at ? new Date(next_action_at).toISOString() : null, ...rest });
  if (error) return fail(error.message);
  if (rest.inquiry_id) revalidatePath(`/inbox/${rest.inquiry_id}`);
  if (rest.customer_id) revalidatePath(`/people/customers/${rest.customer_id}`);
  revalidatePath("/inbox");
  return { ok: "상담 기록을 남겼습니다." };
}

/** 문의 → 고객 등록(또는 기존 고객 연결). 성공하면 계약 등록으로 보낸다. */
export async function convertInquiry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, customer_id: optUuid, go: z.enum(["contract", "stay"]).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("inquiry.write");
  if (!session.can("customer.write")) return fail("고객 등록 권한이 없습니다.");
  const { data: inq } = await supabase.from("inquiry").select("*").eq("id", parsed.data.id).eq("tenant_id", tenantId).maybeSingle();
  if (!inq) return fail("문의를 찾지 못했습니다.");
  let customerId = parsed.data.customer_id ?? inq.customer_id;
  if (!customerId) {
    const utm = (inq.utm ?? {}) as Record<string, string>;
    const { data: c, error } = await supabase
      .from("customer")
      .insert({ tenant_id: tenantId, branch_id: inq.branch_id, name: inq.name ?? "이름 없음", phone: inq.phone, email: inq.email, address: inq.address ?? inq.apt, source_code: inq.channel === "web" ? "web" : inq.channel === "fair" ? "fair" : inq.channel === "partner" ? "partner" : "etc", memo: [inq.kind, inq.message, utm.utm_source && `유입: ${utm.utm_source}`].filter(Boolean).join(" / ").slice(0, 1000), owner_id: inq.assigned_to ?? session.user.id })
      .select("id")
      .single();
    if (error) return fail(error.message);
    customerId = c.id;
    if (inq.apt) await supabase.from("site").insert({ tenant_id: tenantId, customer_id: customerId, name: inq.apt, address: inq.address });
  }
  await supabase.from("inquiry").update({ customer_id: customerId, status: inq.status === "new" || inq.status === "contacted" || inq.status === "quoted" ? "converted" : inq.status }).eq("id", inq.id);
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${inq.id}`);
  if (parsed.data.go === "contract") redirect(`/contracts/new?customer=${customerId}`);
  return { ok: "고객으로 등록했습니다." };
}

export async function markNotificationsRead(formData: FormData) {
  const session = await requireTenant();
  const supabase = await createClient();
  const id = formData.get("id");
  let q = supabase.from("inapp_notification").update({ read_at: new Date().toISOString() }).eq("profile_id", session.user.id).is("read_at", null);
  if (typeof id === "string" && uuid.safeParse(id).success) q = q.eq("id", id);
  await q;
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- 연동 설정
export async function saveTeamsWebhook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ url: z.string().trim().url().or(z.literal("")), is_active: z.enum(["on"]).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("웹훅 주소를 확인해 주세요.");
  const { supabase, tenantId } = await ctx("tenant.manage");
  const { error } = await supabase.from("integration_config").upsert({ tenant_id: tenantId, kind: "teams_webhook", config: { url: parsed.data.url }, is_active: Boolean(parsed.data.url) && parsed.data.is_active === "on" }, { onConflict: "tenant_id,kind" });
  if (error) return fail(error.message);
  revalidatePath("/settings/integrations");
  return { ok: "저장했습니다." };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function rotateWebInquiryKey(_prev: ActionState): Promise<ActionState> {
  const { supabase, tenantId } = await ctx("tenant.manage");
  const key = `jip_${randomBytes(24).toString("base64url")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const { error } = await supabase.from("integration_config").upsert({ tenant_id: tenantId, kind: "web_inquiry", config: { key_hash: keyHash, key_hint: key.slice(0, 8), rotated_at: new Date().toISOString() }, is_active: true }, { onConflict: "tenant_id,kind" });
  if (error) return fail(error.message);
  revalidatePath("/settings/integrations");
  return { ok: `새 API 키 (지금 한 번만 보입니다): ${key}` };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function testTeamsWebhook(_prev: ActionState): Promise<ActionState> {
  const { supabase, tenantId, session } = await ctx("tenant.manage");
  const { data: cfg } = await supabase.from("integration_config").select("config").eq("tenant_id", tenantId).eq("kind", "teams_webhook").maybeSingle();
  const url = (cfg?.config as { url?: string } | null)?.url;
  if (!url) return fail("먼저 웹훅 주소를 저장해 주세요.");
  const { sendTeamsCard } = await import("@/lib/notify/teams");
  try {
    await sendTeamsCard(url, { title: "집대리 연결 확인", text: `${session.current.tenant.name} 의 Teams 알림이 연결되었습니다.` });
    return { ok: "Teams 로 확인 메시지를 보냈습니다." };
  } catch (e) {
    return fail(`보내기 실패: ${String(e).slice(0, 200)}`);
  }
}
