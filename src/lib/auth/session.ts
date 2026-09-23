import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const TENANT_COOKIE = "jip.tenant";

export type Scope = "own" | "branch" | "tenant" | "group";

export type Membership = {
  id: string;
  tenant_id: string;
  role_id: string;
  branch_id: string | null;
  scope: Scope;
  status: string;
  tenant: { id: string; name: string; slug: string; brand: Record<string, unknown> };
  role: { code: string; name: string };
  branch: { id: string; name: string } | null;
};

export type Profile = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
};

export type Session = {
  user: { id: string; email: string | null };
  profile: Profile | null;
  memberships: Membership[];
  current: Membership | null;
  permissions: Set<string>;
  can: (permission: string) => boolean;
};

const MEMBERSHIP_SELECT =
  "id, tenant_id, role_id, branch_id, scope, status, " +
  "tenant:tenant(id, name, slug, brand), role:role(code, name), branch:branch(id, name)";

/** 로그인 사용자 + 소속 사업체 + 현재 사업체 권한. 요청당 한 번만 조회한다. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profile").select("id, display_name, email, phone").eq("id", user.id).maybeSingle(),
    supabase.from("membership").select(MEMBERSHIP_SELECT).eq("status", "active").order("created_at"),
  ]);

  const list = (memberships ?? []) as unknown as Membership[];
  const cookieStore = await cookies();
  const wanted = cookieStore.get(TENANT_COOKIE)?.value;
  const current = list.find((m) => m.tenant_id === wanted) ?? list[0] ?? null;

  let permissions = new Set<string>();
  if (current) {
    const { data: perms } = await supabase.rpc("my_permissions", { p_tenant: current.tenant_id });
    permissions = new Set((perms ?? []) as string[]);
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    profile: (profile as Profile | null) ?? null,
    memberships: list,
    current,
    permissions,
    can: (permission) => permissions.has(permission),
  };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export type TenantSession = Session & { current: Membership };

export async function requireTenant(): Promise<TenantSession> {
  const session = await requireSession();
  if (!session.current) redirect("/onboarding");
  return session as TenantSession;
}
