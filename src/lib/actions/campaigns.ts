"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";

const uuid = z.string().uuid();
const optUuid = z.string().uuid().or(z.literal("")).optional().transform((v) => (v ? v : null));
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional().transform((v) => (v ? v : null));
const fail = (message: string): ActionState => ({ error: message });
const money = z.string().trim().optional().transform((v) => (v ? Number(v.replace(/[^\d]/g, "")) || null : null));

const CHANNELS = ["instagram", "naver", "kakao", "google", "meta", "youtube", "blog", "fair", "partner", "offline", "other"] as const;

const shape = {
  name: z.string().trim().min(1).max(80),
  channel: z.enum(CHANNELS),
  utm_source: z.string().trim().min(1).max(60),
  utm_medium: z.string().trim().min(1).max(60),
  utm_campaign: z.string().trim().min(1).max(80),
  utm_content: optText(80),
  landing_path: z.string().trim().max(300).optional().transform((v) => (v ? v : "/")),
  budget: money,
  starts_on: optDate,
  ends_on: optDate,
  memo: optText(500),
  branch_id: optUuid,
};

async function ctx() {
  const session = await requireTenant();
  if (!session.can("content.publish")) throw new Error("캠페인은 발행 권한이 있어야 만들 수 있습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

function friendly(code: string | undefined, message: string) {
  if (code === "23505") return "같은 utm_source·utm_campaign 조합의 캠페인이 이미 있습니다.";
  if (code === "42501") return "권한이 없습니다.";
  return message;
}

export async function createCampaign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object(shape).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("이름·채널·utm 값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx();
  const { error } = await supabase.from("campaign").insert({ tenant_id: tenantId, ...parsed.data });
  if (error) return fail(friendly(error.code, error.message));
  revalidatePath("/sales/campaigns");
  return { ok: "캠페인을 만들었습니다. 아래 링크를 광고·게시물에 붙여 넣으세요." };
}

export async function updateCampaign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, status: z.enum(["draft", "active", "paused", "ended"]).optional(), ...shape }).partial({ name: true, channel: true, utm_source: true, utm_medium: true, utm_campaign: true }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx();
  const { id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (formData.has(k) && v !== undefined) patch[k] = v;
  const { error, count } = await supabase.from("campaign").update(patch, { count: "exact" }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("캠페인을 찾지 못했습니다.");
  revalidatePath("/sales/campaigns");
  return { ok: "저장했습니다." };
}

export async function deleteCampaign(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase, tenantId } = await ctx();
  await supabase.from("campaign").update({ deleted_at: new Date().toISOString() }).eq("id", id.data).eq("tenant_id", tenantId);
  revalidatePath("/sales/campaigns");
}
