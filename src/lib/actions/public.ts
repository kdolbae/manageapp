"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/actions/auth";

const fail = (message: string): ActionState => ({ error: message });
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}$/);
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

/** 고객 페이지 후기 (로그인 없음, 계약 비밀 링크 토큰으로 확인) */
export async function submitCustomerReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ slug, token: z.string().min(16).max(64), rating: z.coerce.number().int().min(1).max(5), body: z.string().trim().min(5).max(2000), author: optText(40), consent: z.enum(["on"]).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("별점과 후기 내용(5자 이상)을 적어 주세요.");
  const admin = createAdminClient();
  if (!admin) return fail("지금은 후기를 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
  const { slug: s, token, rating, body, author, consent } = parsed.data;
  const { error } = await admin.rpc("customer_submit_review", { p_slug: s, p_token: token, p_rating: rating, p_body: body, p_author: author, p_consent: consent === "on" });
  if (error) return fail(error.code === "42501" ? "링크가 올바르지 않습니다." : "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  revalidatePath(`/c/${s}/${token}`);
  return { ok: "후기를 남겨 주셔서 감사합니다." };
}

/** 브랜드 페이지 문의 폼 (로그인 없음) */
export async function brandInquiry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      slug, name: z.string().trim().min(1).max(60), phone: z.string().trim().min(8).max(30), apt: optText(100), kind: optText(60), message: optText(2000), website: optText(200),
      utm_source: optText(100), utm_medium: optText(100), utm_campaign: optText(100), utm_term: optText(100), utm_content: optText(100), referrer: optText(300), source_page: optText(300),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("이름과 전화번호를 확인해 주세요.");
  const d = parsed.data;
  if (d.website) return { ok: "접수되었습니다." }; // 허니팟: 봇은 조용히 무시
  const admin = createAdminClient();
  if (!admin) return fail("지금은 문의를 받을 수 없습니다. 전화로 연락해 주세요.");
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer"] as const) if (d[k]) utm[k] = d[k]!;
  const { error } = await admin.rpc("customer_inquiry", { p_slug: d.slug, p: { name: d.name, phone: d.phone, apt: d.apt, kind: d.kind, message: d.message, source_page: d.source_page ?? `/c/${d.slug}`, utm } });
  if (error) return fail("접수하지 못했습니다. 전화로 연락해 주세요.");
  // 알림 발송(Teams)은 시간마다 도는 배치가 처리한다. 바로 보내고 싶으면 아래를 켠다.
  try {
    const { deliverPending } = await import("@/lib/notify/deliver");
    const { siteOrigin } = await import("@/lib/origin");
    await deliverPending(admin, { limit: 5, siteUrl: await siteOrigin() });
  } catch {
    /* 발송 실패는 배치가 다시 시도한다 */
  }
  return { ok: "접수되었습니다. 곧 연락드리겠습니다." };
}
