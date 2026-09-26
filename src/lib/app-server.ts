import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 집대리 소비자 앱 서버(kdolbae/jipdarie 의 Cloudflare Worker) → 이 시스템, 서버 대 서버 API.
 *  - 인증: `authorization: Bearer <APP_SERVER_KEY>` (환경변수. 앱에는 없고 앱 Worker 비밀값에만 있다)
 *  - 회원: `x-app-user: <앱 회원 id>` → 고객 요청의 external_id 'jipdarie:<id>'. 앱 Worker 가 로그인 세션으로 확인한 값만 보낸다
 *  - 요청은 그 회원 것만 다룬다: 요청 id → 회원의 요청 목록에서 토큰을 찾아 토큰 함수(request_*)를 부른다
 */
export const EXTERNAL_PREFIX = "jipdarie:";
const USER_RE = /^[A-Za-z0-9_-]{4,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

const digest = (v: string) => createHash("sha256").update(v).digest();

/** 키가 맞는지 (길이 차이로 새지 않게 해시끼리 비교). 키가 설정되지 않았으면 항상 거절 */
export function keyMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

type Ctx = { admin: SupabaseClient; external: string };

/** 인증·회원 확인. 실패하면 응답을, 성공하면 컨텍스트를 돌려준다 */
export function appContext(request: Request, { needUser = true } = {}): Ctx | NextResponse {
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!keyMatches(given, process.env.APP_SERVER_KEY)) return json({ error: "unauthorized" }, 401);
  const user = request.headers.get("x-app-user") ?? "";
  if (needUser && !USER_RE.test(user)) return json({ error: "app user required" }, 400);
  const admin = createAdminClient();
  if (!admin) return json({ error: "server not configured" }, 503);
  return { admin, external: EXTERNAL_PREFIX + user };
}

export type OwnedRequest = { id: string; token: string; status: string };

/** 이 회원의 요청 목록 */
export async function listOwned(ctx: Ctx): Promise<OwnedRequest[] | null> {
  const { data, error } = await ctx.admin.rpc("requests_by_external", { p_external: ctx.external });
  if (error) return null;
  return (data ?? []) as OwnedRequest[];
}

/** 요청 id 가 이 회원 것이면 토큰을, 아니면 null (남의 요청은 없는 것처럼) */
export async function ownedToken(ctx: Ctx, requestId: string): Promise<string | null> {
  if (!isUuid(requestId)) return null;
  const owned = await listOwned(ctx);
  return owned?.find((r) => r.id === requestId)?.token ?? null;
}

/** DB 함수 오류 → 앱에 보여줄 말 */
export function rpcFail(error: { code?: string; message?: string }) {
  if (error.code === "42501" || error.code === "22023") return json({ error: error.message ?? "할 수 없는 요청입니다." }, 422);
  return json({ error: "처리하지 못했습니다." }, 500);
}
