import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverPending } from "@/lib/notify/deliver";

/**
 * 홈페이지 → 집대리 문의 인입.
 *  POST /api/public/inquiry  (헤더 x-api-key: 사업체별 문의 API 키)
 *  body: { name, phone, email, address, apt, kind, message, source_page, utm:{...}, extra:{...}, attachments:[{name,url}], external_id, website(허니팟) }
 */
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(request: Request) {
  const key = request.headers.get("x-api-key") ?? "";
  if (!key) return NextResponse.json({ error: "missing api key" }, { status: 401, headers: cors });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "server not configured" }, { status: 503, headers: cors });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400, headers: cors });
  }
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true, skipped: "honeypot" }, { status: 200, headers: cors }); // 봇: 조용히 무시
  }
  const str = (k: string, max = 500) => (typeof body[k] === "string" ? String(body[k]).trim().slice(0, max) : null);
  const payload = {
    channel: str("channel", 20) ?? "web",
    kind: str("kind", 60),
    name: str("name", 60),
    phone: str("phone", 30),
    email: str("email", 120),
    address: str("address", 200),
    apt: str("apt", 100),
    message: str("message", 4000),
    source_page: str("source_page", 300),
    external_id: str("external_id", 100),
    utm: typeof body.utm === "object" && body.utm ? body.utm : {},
    extra: typeof body.extra === "object" && body.extra ? body.extra : {},
    attachments: Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : [],
  };
  if (!payload.name && !payload.phone && !payload.message) {
    return NextResponse.json({ error: "name, phone or message required" }, { status: 422, headers: cors });
  }
  const keyHash = createHash("sha256").update(key).digest("hex");
  const { data: id, error } = await admin.rpc("ingest_web_inquiry", { p_key_hash: keyHash, p: payload });
  if (error) {
    const status = error.code === "42501" ? 401 : 500;
    return NextResponse.json({ error: status === 401 ? "invalid api key" : "insert failed" }, { status, headers: cors });
  }
  // 알림은 바로 시도 (Teams). 실패해도 인입은 성공으로 응답하고 다음 주기에 재시도.
  if (id) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
    try {
      await deliverPending(admin, { siteUrl, limit: 5 });
    } catch {
      /* 대기열에 남는다 */
    }
  }
  return NextResponse.json({ ok: true, id: id ?? null, duplicate: !id }, { status: id ? 201 : 200, headers: cors });
}
