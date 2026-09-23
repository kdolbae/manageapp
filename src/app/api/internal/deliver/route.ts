import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverPending } from "@/lib/notify/deliver";

/** 알림 대기열 처리. Vercel Cron 또는 수동 호출 (Authorization: Bearer CRON_SECRET). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "server not configured" }, { status: 503 });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
  const result = await deliverPending(admin, { siteUrl, limit: 50 });
  return NextResponse.json(result);
}
