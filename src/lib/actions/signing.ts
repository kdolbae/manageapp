"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";
import { SIGNATURE_DATA_RE, SIGNATURE_MAX } from "@/lib/signing";

const fail = (message: string): ActionState => ({ error: message });
const on = z.enum(["on"]).optional();
const signFields = {
  signer_name: z.string().trim().min(1).max(60),
  signature_data: z.string().min(200).max(SIGNATURE_MAX).regex(SIGNATURE_DATA_RE),
  consent_terms: on,
  consent_privacy: on,
  consent_marketing: on,
};
type SignFields = { signer_name: string; signature_data: string; consent_terms?: "on"; consent_privacy?: "on"; consent_marketing?: "on" };

function consentsOf(d: SignFields) {
  return { terms: d.consent_terms === "on", privacy: d.consent_privacy === "on", marketing: d.consent_marketing === "on" };
}
function issueMessage(err: z.ZodError) {
  const path = String(err.issues[0]?.path[0] ?? "");
  if (path === "signature_data") return "서명을 해 주세요.";
  if (path === "phone_tail") return "휴대폰 번호 뒷 4자리를 숫자로 적어 주세요.";
  if (path === "signer_name") return "서명자 이름을 적어 주세요.";
  return "입력값을 확인해 주세요.";
}
async function clientMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    user_agent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}
const dbMessage = (code: string | undefined, message: string, noPerm: string) =>
  code === "42501" ? noPerm : code === "22023" ? message : "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

/** 현장 기기(태블릿·박람회 노트북)에서 로그인한 직원이 고객 서명을 받는다. RLS: 계약이 보이고 contract.write 또는 배정 기사 */
export async function signOnDevice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: z.string().uuid(), ...signFields }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error));
  const consents = consentsOf(parsed.data);
  if (!consents.terms || !consents.privacy) return fail("필수 동의 두 가지에 체크해 주세요.");
  const session = await requireTenant();
  const supabase = await createClient();
  const meta = await clientMeta();
  const { error } = await supabase.from("contract_signature").insert({
    tenant_id: session.current.tenant_id,
    contract_id: parsed.data.id,
    signer_name: parsed.data.signer_name,
    signature_data: parsed.data.signature_data,
    consents,
    ...meta,
  });
  if (error) return fail(dbMessage(error.code, error.message, "이 계약에 서명을 받을 권한이 없습니다."));
  revalidatePath(`/contracts/${parsed.data.id}`);
  redirect(`/sign/${parsed.data.id}?done=1`);
}

/** 고객이 자기 계약 링크(/c/<slug>/<token>)에서 서명한다 (로그인 없음, 서비스 키 RPC, 휴대폰 뒷 4자리 확인) */
export async function signByLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}$/),
      token: z.string().min(16).max(64),
      phone_tail: z.string().trim().regex(/^\d{4}$/).optional().or(z.literal("")),
      ...signFields,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error));
  const consents = consentsOf(parsed.data);
  if (!consents.terms || !consents.privacy) return fail("필수 동의 두 가지에 체크해 주세요.");
  const admin = createAdminClient();
  if (!admin) return fail("지금은 서명을 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
  const meta = await clientMeta();
  const { slug, token } = parsed.data;
  const { error } = await admin.rpc("customer_sign_contract", {
    p_slug: slug,
    p_token: token,
    p_signer_name: parsed.data.signer_name,
    p_phone_tail: parsed.data.phone_tail || null,
    p_signature_data: parsed.data.signature_data,
    p_consents: consents,
    p_ip: meta.ip,
    p_user_agent: meta.user_agent,
  });
  if (error) return fail(dbMessage(error.code, error.message, "링크가 올바르지 않습니다."));
  revalidatePath(`/c/${slug}/${token}`);
  return { ok: "서명이 저장되었습니다. 감사합니다." };
}
