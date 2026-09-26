import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_CORS, SLUG_RE, TOKEN_RE } from "@/lib/app-link";

/**
 * 집대리 앱에서 남기는 시공 후기. 고객 페이지 후기와 같은 함수(customer_submit_review)라 계약당 하나, 다시 보내면 고친다.
 *  POST /api/public/v1/contract/review  { slug, token, rating(1~5), body(5자 이상), author?, consent? }
 *  새 후기는 발행 권한자에게 앱 내 알림이 가고, 콘텐츠 > 후기에서 승인해야 공개된다.
 */
const input = z.object({
  slug: z.string().regex(SLUG_RE),
  token: z.string().regex(TOKEN_RE),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(5).max(2000),
  author: z.string().trim().max(40).optional(),
  consent: z.boolean().optional(),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS });
}

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "별점과 후기 내용(5자 이상)을 적어 주세요." }, { status: 422, headers: PUBLIC_CORS });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "server not configured" }, { status: 503, headers: PUBLIC_CORS });
  const { slug, token, rating, body, author, consent } = parsed.data;
  const { data, error } = await admin.rpc("customer_submit_review", {
    p_slug: slug, p_token: token, p_rating: rating, p_body: body, p_author: author ?? null, p_consent: consent ?? false,
  });
  if (error) {
    const status = error.code === "42501" ? 404 : 500;
    return NextResponse.json({ error: status === 404 ? "링크가 올바르지 않습니다." : "저장하지 못했습니다." }, { status, headers: PUBLIC_CORS });
  }
  return NextResponse.json({ ok: true, id: data }, { status: 201, headers: PUBLIC_CORS });
}
