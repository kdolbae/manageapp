import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/origin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { inviteMember, updateMembership, deleteInvitation } from "@/lib/actions/settings";

export const metadata = { title: "구성원" };

const SCOPE_LABEL: Record<string, string> = {
  own: "본인 건만",
  branch: "지점",
  tenant: "사업체 전체",
  group: "그룹 전체",
};

type MemberRow = {
  id: string;
  profile_id: string;
  role_id: string;
  branch_id: string | null;
  scope: string;
  status: string;
  job_title: string | null;
  profile: { display_name: string; email: string | null; phone: string | null } | null;
  role: { code: string; name: string } | null;
  branch: { name: string } | null;
};
type RoleRow = { id: string; code: string; name: string; default_scope: string; tenant_id: string | null };
type BranchRow = { id: string; code: string; name: string };
type InviteRow = {
  id: string;
  email: string;
  token: string;
  scope: string;
  expires_at: string;
  role: { name: string } | null;
  branch: { name: string } | null;
};

export default async function MembersPage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const origin = await siteOrigin();

  const [{ data: members }, { data: roles }, { data: branches }, { data: invites }] = await Promise.all([
    supabase
      .from("membership")
      .select(
        "id, profile_id, role_id, branch_id, scope, status, job_title, profile:profile(display_name, email, phone), role:role(code, name), branch:branch(name)",
      )
      .eq("tenant_id", tid)
      .order("created_at"),
    supabase
      .from("role")
      .select("id, code, name, default_scope, tenant_id")
      .or(`tenant_id.is.null,tenant_id.eq.${tid}`)
      .order("sort_order"),
    supabase.from("branch").select("id, code, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("is_hq", { ascending: false }).order("name"),
    supabase
      .from("invitation")
      .select("id, email, token, scope, expires_at, role:role(name), branch:branch(name)")
      .eq("tenant_id", tid)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const rows = (members ?? []) as unknown as MemberRow[];
  const roleList = (roles ?? []) as RoleRow[];
  const branchList = (branches ?? []) as BranchRow[];
  const inviteList = (invites ?? []) as unknown as InviteRow[];
  const editable = session.can("member.manage");
  const isOwner = session.current.role.code === "owner";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="grid gap-4">
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일 · 전화</th>
                <th>역할</th>
                <th>범위</th>
                <th>지점</th>
                <th>상태</th>
                {editable && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const me = m.profile_id === session.user.id;
                return (
                  <tr key={m.id}>
                    <td className="font-semibold">
                      {m.profile?.display_name || "(이름 없음)"} {me && <span className="text-muted font-normal text-xs">(나)</span>}
                      {m.job_title && <div className="text-xs text-muted font-normal">{m.job_title}</div>}
                    </td>
                    <td className="text-muted">
                      <div>{m.profile?.email ?? "—"}</div>
                      {m.profile?.phone && <div className="mono">{m.profile.phone}</div>}
                    </td>
                    <td>{m.role?.name}</td>
                    <td>{SCOPE_LABEL[m.scope] ?? m.scope}</td>
                    <td>{m.branch?.name ?? <span className="zero">—</span>}</td>
                    <td>
                      <span className={"badge " + (m.status === "active" ? "badge-done" : m.status === "invited" ? "badge-wait" : "badge-risk")}>
                        {m.status === "active" ? "활성" : m.status === "invited" ? "초대됨" : "정지"}
                      </span>
                    </td>
                    {editable && (
                      <td>
                        <details>
                          <summary className="cursor-pointer text-accent text-xs">권한 변경</summary>
                          <ActionForm action={updateMembership} className="mt-2 grid gap-2 min-w-[240px]">
                            <input type="hidden" name="id" value={m.id} />
                            <select name="role_id" defaultValue={m.role_id} className="field">
                              {roleList.map((r) => (
                                <option key={r.id} value={r.id} disabled={r.code === "owner" && !isOwner}>
                                  {r.name}{r.tenant_id ? " (맞춤)" : ""}
                                </option>
                              ))}
                            </select>
                            <select name="scope" defaultValue={m.scope} className="field">
                              {Object.entries(SCOPE_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                            <select name="branch_id" defaultValue={m.branch_id ?? ""} className="field">
                              <option value="">지점 없음(본사 공통)</option>
                              {branchList.map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                            <input name="job_title" defaultValue={m.job_title ?? ""} maxLength={30} placeholder="직함(선택)" className="field" />
                            <select name="status" defaultValue={m.status === "suspended" ? "suspended" : "active"} className="field" disabled={me}>
                              <option value="active">활성</option>
                              <option value="suspended">정지</option>
                            </select>
                            {me && <input type="hidden" name="status" value="active" />}
                            <SubmitButton className="btn btn-sm">저장</SubmitButton>
                          </ActionForm>
                        </details>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={editable ? 7 : 6}>{rows.length}명</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {editable && inviteList.length > 0 && (
          <div className="card overflow-x-auto">
            <div className="panel-head"><h2>대기 중인 초대 <span className="sub">{inviteList.length}건</span></h2></div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>이메일</th>
                  <th>역할</th>
                  <th>범위</th>
                  <th>만료</th>
                  <th>초대 링크</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {inviteList.map((i) => {
                  const link = `${origin}/invite/${i.token}`;
                  const expired = new Date(i.expires_at) < new Date();
                  return (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{i.role?.name}</td>
                      <td>{SCOPE_LABEL[i.scope]}{i.branch ? ` · ${i.branch.name}` : ""}</td>
                      <td className="mono text-muted">{expired ? "만료" : i.expires_at.slice(0, 10)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="mono text-xs text-muted max-w-[220px] truncate">{link}</span>
                          <CopyButton text={link} />
                        </div>
                      </td>
                      <td>
                        <form action={deleteInvitation}>
                          <input type="hidden" name="id" value={i.id} />
                          <button className="btn btn-sm btn-danger">취소</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editable && (
        <ActionForm action={inviteMember} className="card p-4">
          <h2 className="text-sm font-semibold mb-1">구성원 초대</h2>
          <p className="text-xs text-muted mb-3">
            초대 링크를 만들어 카톡·문자로 전달합니다. 상대가 같은 이메일로 로그인하면 바로 소속됩니다.
          </p>
          <div className="form-row">
            <label className="label" htmlFor="inv-email">이메일<span className="req">*</span></label>
            <input id="inv-email" name="email" type="email" required className="field" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="inv-role">역할<span className="req">*</span></label>
            <select id="inv-role" name="role_id" className="field" defaultValue={roleList.find((r) => r.code === "staff")?.id}>
              {roleList.map((r) => (
                <option key={r.id} value={r.id} disabled={r.code === "owner" && !isOwner}>
                  {r.name}{r.tenant_id ? " (맞춤)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="inv-scope">볼 수 있는 범위</label>
            <select id="inv-scope" name="scope" className="field" defaultValue="tenant">
              {Object.entries(SCOPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="inv-branch">지점</label>
            <select id="inv-branch" name="branch_id" className="field" defaultValue="">
              <option value="">지점 없음(본사 공통)</option>
              {branchList.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <SubmitButton>초대 링크 만들기</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
