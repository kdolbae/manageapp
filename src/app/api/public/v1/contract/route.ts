import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedUrlMap } from "@/lib/public";
import { PUBLIC_CORS, SLUG_RE, TOKEN_RE } from "@/lib/app-link";

/**
 * 집대리 앱 "내 시공" — 계약 비밀 링크(/c/<slug>/<token>)로 계약 자료를 JSON 으로 준다.
 *  GET /api/public/v1/contract?slug=<사업체>&token=<계약 토큰>
 *  고객 페이지(/c/<slug>/<token>)와 같은 customer_page() 를 읽는다. 이름은 가려서, 전화는 끝 4자리만.
 *  사진은 1시간짜리 서명 주소로 바꿔 준다.
 */
type Photo = { path: string; kind: string; job_id: string | null; taken_at: string };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const noStore = { ...PUBLIC_CORS, "cache-control": "no-store" };
  if (!SLUG_RE.test(slug) || !TOKEN_RE.test(token)) return NextResponse.json({ error: "invalid link" }, { status: 400, headers: noStore });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "server not configured" }, { status: 503, headers: noStore });

  const { data, error } = await admin.rpc("customer_page", { p_slug: slug, p_token: token });
  if (error) return NextResponse.json({ error: "query failed" }, { status: 500, headers: noStore });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404, headers: noStore });

  const d = data as Record<string, unknown> & { photos: Photo[] };
  const urls = await signedUrlMap(admin, d.photos.map((p) => p.path));
  const photos = d.photos
    .map(({ path, ...rest }) => ({ ...rest, url: urls.get(path) ?? null }))
    .filter((p) => p.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? url.origin;
  return NextResponse.json(
    { ...d, photos, page_url: `${siteUrl}/c/${slug}/${token}`, fetched_at: new Date().toISOString() },
    { headers: noStore },
  );
}
