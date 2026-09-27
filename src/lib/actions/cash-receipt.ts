"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { randomInt } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenant } from "@/lib/auth/session";
import { siteOrigin } from "@/lib/origin";
import { handleCashReceiptMessage } from "@/lib/cash-receipt/process";
import type { ActionState } from "@/lib/actions/auth";

const fail = (message: string): ActionState => ({ error: message });

async function ctx() {
  const session = await requireTenant();
  if (!session.can("tenant.manage")) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

export async function saveCashReceiptSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      provider: z.enum(["mock", "popbill"]),
      corp_num: z.string().trim().max(20).optional().transform((v) => (v ?? "").replace(/\D/g, "")),
      item_name: z.string().trim().max(60).optional().transform((v) => v ?? ""),
      taxation: z.enum(["taxable", "exempt"]),
      is_active: z.enum(["on"]).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const d = parsed.data;
  if (d.provider === "popbill" && d.corp_num.length !== 10) return fail("팝빌로 발행하려면 가맹점 사업자번호 10자리가 필요합니다.");
  const { supabase, tenantId } = await ctx();
  const { error } = await supabase.from("integration_config").upsert(
    { tenant_id: tenantId, kind: "cash_receipt", config: { provider: d.provider, corp_num: d.corp_num, item_name: d.item_name, taxation: d.taxation }, is_active: d.is_active === "on" },
    { onConflict: "tenant_id,kind" },
  );
  if (error) return fail(error.message);
  revalidatePath("/settings/integrations");
  return { ok: "저장했습니다." };
}

/** 채팅방 연결 코드(8자, 30분). 채팅방에 "집대리 연결 코드" 를 보내면 그 방이 이 사업체에 연결된다. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function issueTeamsLinkCode(_prev: ActionState): Promise<ActionState> {
  const { supabase, tenantId } = await ctx();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const expires = new Date(Date.now() + 30 * 60_000).toISOString();
  const { data: cur } = await supabase.from("integration_config").select("config").eq("tenant_id", tenantId).eq("kind", "teams_bot").maybeSingle();
  const { error } = await supabase.from("integration_config").upsert(
    { tenant_id: tenantId, kind: "teams_bot", config: { ...((cur?.config as object) ?? {}), link_code: code, link_code_expires_at: expires }, is_active: true },
    { onConflict: "tenant_id,kind" },
  );
  if (error) return fail(error.message);
  revalidatePath("/settings/integrations");
  return { ok: `채팅방에 이렇게 보내세요 (30분 안에, 한 번만): 집대리 연결 ${code}` };
}

export async function setTeamsConversationActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ conversation_id: z.string().min(3).max(300), active: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase } = await ctx();
  const { error } = await supabase.from("teams_conversation").update({ is_active: parsed.data.active === "1" }).eq("conversation_id", parsed.data.conversation_id);
  if (error) return fail(error.message);
  revalidatePath("/settings/integrations");
  return { ok: parsed.data.active === "1" ? "다시 켰습니다." : "연결을 껐습니다." };
}

/** Teams 없이 시험: 채팅방에 올라올 메시지를 붙여 넣으면 같은 흐름으로 처리한다. */
export async function tryCashReceiptMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return fail("메시지를 붙여 넣어 주세요.");
  const { session, tenantId } = await ctx();
  const admin = createAdminClient();
  if (!admin) return fail("서버 키(SUPABASE_SECRET_KEY)가 없어 시험할 수 없습니다.");
  const out = await handleCashReceiptMessage(admin, { tenantId, text: text.slice(0, 4000), source: "manual", senderName: session.profile?.display_name ?? undefined, senderRef: session.user.id, siteUrl: await siteOrigin() });
  revalidatePath("/settings/integrations");
  if (out.status === "ignored") return fail("현금영수증 요청으로 읽히지 않았어요. '현금영수증 신청합니다' 문장이 있어야 합니다.");
  const msg = out.imageUrl ? `${out.message} · 이미지: ${out.imageUrl}` : out.message;
  return out.status === "issued" || out.status === "resent" ? { ok: msg } : fail(msg);
}
