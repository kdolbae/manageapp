import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "역할·권한" };

type Perm = { code: string; module: string; label: string };
type Role = { id: string; code: string; name: string; description: string | null; default_scope: string; tenant_id: string | null };

const SCOPE_LABEL: Record<string, string> = { own: "본인", branch: "지점", tenant: "사업체", group: "그룹" };

export default async function RolesPage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const [{ data: perms }, { data: roles }] = await Promise.all([
    supabase.from("permission_catalog").select("code, module, label").order("sort_order"),
    supabase.from("role").select("id, code, name, description, default_scope, tenant_id").or(`tenant_id.is.null,tenant_id.eq.${tid}`).order("sort_order"),
  ]);
  const permList = (perms ?? []) as Perm[];
  const roleList = (roles ?? []) as Role[];
  const { data: rp } = await supabase
    .from("role_permission")
    .select("role_id, permission")
    .in("role_id", roleList.map((r) => r.id));
  const granted = new Set((rp ?? []).map((x: { role_id: string; permission: string }) => `${x.role_id}:${x.permission}`));

  const modules: string[] = [];
  for (const p of permList) if (!modules.includes(p.module)) modules.push(p.module);

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted">
        기본 역할 7개는 모든 사업체가 함께 씁니다. 권한은 화면 메뉴뿐 아니라 데이터베이스 규칙(RLS)으로도 강제됩니다.
        사업체 맞춤 역할 만들기는 다음 단계에서 열립니다.
      </p>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>권한</th>
              {roleList.map((r) => (
                <th key={r.id} className="text-center">
                  <div>{r.name}</div>
                  <div className="font-normal text-[10.5px]">{SCOPE_LABEL[r.default_scope]} 범위</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((mod) => (
              <Fragment key={mod}>
                <tr>
                  <td colSpan={roleList.length + 1} className="font-semibold bg-bg text-xs">{mod}</td>
                </tr>
                {permList
                  .filter((p) => p.module === mod)
                  .map((p) => (
                    <tr key={p.code}>
                      <td>
                        {p.label} <span className="mono text-[10.5px] text-muted ml-1">{p.code}</span>
                      </td>
                      {roleList.map((r) => (
                        <td key={r.id} className="text-center">
                          {granted.has(`${r.id}:${p.code}`) ? <span className="text-success font-bold">●</span> : <span className="zero">·</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { Fragment } from "react";
