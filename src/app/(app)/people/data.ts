import type { createClient } from "@/lib/supabase/server";

export type Db = Awaited<ReturnType<typeof createClient>>;
export type Option = { id: string; name: string };

/** 운영 중인 지점(본사 먼저). */
export async function branchOptions(db: Db, tenantId: string): Promise<Option[]> {
  const { data } = await db
    .from("branch")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("is_hq", { ascending: false })
    .order("sort_order")
    .order("name");
  return (data ?? []) as Option[];
}

type MemberRow = {
  profile_id: string;
  profile: { display_name: string; email: string | null } | null;
  role: { code: string } | null;
};

/** 활성 구성원(담당자·앱 계정 선택용). roleCode 를 주면 그 역할만. id 는 profile_id. */
export async function memberOptions(db: Db, tenantId: string, roleCode?: string): Promise<Option[]> {
  const { data } = await db
    .from("membership")
    .select("profile_id, profile:profile(display_name, email), role:role(code)")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  const rows = (data ?? []) as unknown as MemberRow[];
  return rows
    .filter((m) => !roleCode || m.role?.code === roleCode)
    .map((m) => ({ id: m.profile_id, name: m.profile?.display_name || m.profile?.email || "(이름 없음)" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 거래 중인 협력업체. types 를 주면 그 유형 중 하나라도 가진 업체만. */
export async function partnerOptions(db: Db, tenantId: string, types?: string[]): Promise<Option[]> {
  let query = db.from("partner").select("id, name").eq("tenant_id", tenantId).eq("status", "active").is("deleted_at", null);
  if (types) query = query.overlaps("types", types);
  const { data } = await query.order("name");
  return (data ?? []) as Option[];
}

/** 아파트 단지. */
export async function complexOptions(db: Db, tenantId: string): Promise<Option[]> {
  const { data } = await db.from("complex").select("id, name").eq("tenant_id", tenantId).is("deleted_at", null).order("name");
  return (data ?? []) as Option[];
}

/** 현재 값이 선택지에 없으면(중지된 지점·정지된 구성원 등) 끼워 넣어, 저장할 때 값이 날아가지 않게 한다. */
export function ensureOption(list: Option[], id: string | null | undefined, name?: string | null) {
  if (id && !list.some((o) => o.id === id)) list.push({ id, name: name ?? "(현재 값)" });
}
