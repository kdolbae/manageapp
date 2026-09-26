import { NextResponse } from "next/server";
import { getSession, type TenantSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** 로그인 + 현재 사업체 + 권한. 실패하면 응답을 돌려준다. RLS 가 한 번 더 막는다. */
export async function apiAuth(perm: string): Promise<
  { ok: true; session: TenantSession; db: Awaited<ReturnType<typeof createClient>>; tid: string } | { ok: false; res: NextResponse }
> {
  const session = await getSession();
  if (!session) return { ok: false, res: json({ error: "로그인이 필요합니다." }, 401) };
  if (!session.current) return { ok: false, res: json({ error: "사업체를 먼저 고르세요." }, 403) };
  if (!session.can(perm)) return { ok: false, res: json({ error: "권한이 없습니다." }, 403) };
  return { ok: true, session: session as TenantSession, db: await createClient(), tid: session.current.tenant_id };
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function dbError(code: string | undefined, fallback = "저장하지 못했습니다."): string {
  if (code === "23514") return "메모에 전화번호를 적을 수 없습니다(금액·채널 값도 확인해 주세요).";
  if (code === "23505") return "그 계약은 다른 전환에 이미 붙어 있습니다. 같은 계약을 두 번 붙이면 매출이 두 번 잡힙니다.";
  if (code === "23503") return "같은 사업체의 계약만 붙일 수 있습니다.";
  if (code === "42501") return "권한이 없습니다.";
  return fallback;
}
