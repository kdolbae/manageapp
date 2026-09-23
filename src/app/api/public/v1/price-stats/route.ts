import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_CORS, SLUG_RE } from "@/lib/app-link";

/**
 * 집대리 앱 예상가격용 실제 계약 금액 집계.
 *  GET /api/public/v1/price-stats?slug=<사업체>&months=6
 *  응답: { since, until, entries: [{ serviceId, region, sampleSize, samplePeriod, lowPrice, avgPrice, highPrice, updatedAt }] }
 *  표본 5건 미만 묶음은 DB 함수가 빼고 내보낸다. 앱은 30건 이상일 때만 기준으로 쓴다.
 */
type Row = { service_id: string; region: string; sample_size: number; low: number; avg: number; high: number };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const months = Math.min(24, Math.max(1, Number(url.searchParams.get("months")) || 6));
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: "slug required" }, { status: 400, headers: PUBLIC_CORS });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "server not configured" }, { status: 503, headers: PUBLIC_CORS });

  const { data, error } = await admin.rpc("app_price_stats", { p_slug: slug, p_months: months });
  if (error) return NextResponse.json({ error: "query failed" }, { status: 500, headers: PUBLIC_CORS });
  if (!data) return NextResponse.json({ error: "unknown tenant" }, { status: 404, headers: PUBLIC_CORS });

  const d = data as { since: string; until: string; entries: Row[] };
  const period = `최근 ${months}개월`;
  const entries = d.entries.map((e) => ({
    serviceId: e.service_id,
    region: e.region,
    sampleSize: e.sample_size,
    samplePeriod: period,
    lowPrice: Number(e.low),
    avgPrice: Number(e.avg),
    highPrice: Number(e.high),
    updatedAt: d.until,
  }));
  return NextResponse.json(
    { since: d.since, until: d.until, entries },
    { headers: { ...PUBLIC_CORS, "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
