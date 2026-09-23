import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { phone } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { assignOrg, createDepartment, createPosition, deleteDepartment, updateDepartment, updatePosition } from "@/lib/actions/groupware";
import { branchOptions, type Option } from "@/app/(app)/people/data";

export const metadata = { title: "조직도" };

type Dept = { id: string; name: string; parent_id: string | null; branch_id: string | null; sort_order: number };
type Pos = { id: string; name: string; rank: number };
type Member = {
  id: string;
  profile_id: string;
  branch_id: string | null;
  department_id: string | null;
  position_id: string | null;
  job_title: string | null;
  profile: { display_name: string; email: string | null; phone: string | null } | null;
  role: { name: string } | null;
};

/** 부서 폼(추가·수정 공용) */
function DeptFields({ v, depts, branches, idPrefix }: { v: Partial<Dept>; depts: Dept[]; branches: Option[]; idPrefix: string }) {
  const id = (n: string) => `${idPrefix}-${n}`;
  return (
    <>
      <div className="form-row">
        <label className="label" htmlFor={id("name")}>부서 이름<span className="req">*</span></label>
        <input id={id("name")} name="name" required maxLength={40} defaultValue={v.name ?? ""} className="field" />
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("parent")}>상위 부서</label>
        <select id={id("parent")} name="parent_id" defaultValue={v.parent_id ?? ""} className="field">
          <option value="">없음(최상위)</option>
          {depts.filter((d) => d.id !== v.id).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        {branches.length > 1 ? (
          <div className="form-row">
            <label className="label" htmlFor={id("branch")}>지점</label>
            <select id={id("branch")} name="branch_id" defaultValue={v.branch_id ?? ""} className="field">
              <option value="">공통</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="branch_id" value={v.branch_id ?? ""} />
        )}
        <div className="form-row">
          <label className="label" htmlFor={id("sort")}>순서</label>
          <input id={id("sort")} name="sort_order" type="number" min={0} max={9999} defaultValue={v.sort_order ?? 0} className="field mono" />
        </div>
      </div>
    </>
  );
}

function MemberTable({ members, positions, depts, editable }: { members: Member[]; positions: Pos[]; depts: Dept[]; editable: boolean }) {
  const posOf = new Map(positions.map((p) => [p.id, p]));
  const rank = (m: Member) => posOf.get(m.position_id ?? "")?.rank ?? 9999;
  const sorted = [...members].sort((a, b) => rank(a) - rank(b) || (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? "", "ko"));
  if (sorted.length === 0) return <p className="px-4 py-2 text-xs text-muted">구성원이 없습니다.</p>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>이름</th>
          <th>직위</th>
          <th>직함</th>
          <th>역할</th>
          <th>전화</th>
          {editable && <th></th>}
        </tr>
      </thead>
      <tbody>
        {sorted.map((m) => (
          <tr key={m.id}>
            <td className="font-semibold">{m.profile?.display_name || m.profile?.email || "(이름 없음)"}</td>
            <td>{posOf.get(m.position_id ?? "")?.name ?? <span className="zero">—</span>}</td>
            <td className="text-muted">{m.job_title ?? "—"}</td>
            <td className="text-xs">{m.role?.name}</td>
            <td className="mono text-xs">{m.profile?.phone ? phone(m.profile.phone) : <span className="zero">—</span>}</td>
            {editable && (
              <td>
                <details>
                  <summary className="cursor-pointer text-accent text-xs">배치</summary>
                  <ActionForm action={assignOrg} className="mt-2 grid gap-2 min-w-[240px]">
                    <input type="hidden" name="id" value={m.id} />
                    <select name="department_id" defaultValue={m.department_id ?? ""} className="field" aria-label="부서">
                      <option value="">부서 없음</option>
                      {depts.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <select name="position_id" defaultValue={m.position_id ?? ""} className="field" aria-label="직위">
                      <option value="">직위 없음</option>
                      {positions.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <input name="job_title" defaultValue={m.job_title ?? ""} maxLength={30} placeholder="직함(선택)" className="field" />
                    <SubmitButton className="btn btn-sm">저장</SubmitButton>
                  </ActionForm>
                </details>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeptNode({
  dept,
  depth,
  childrenOf,
  membersOf,
  depts,
  positions,
  branches,
  editable,
}: {
  dept: Dept;
  depth: number;
  childrenOf: Map<string, Dept[]>;
  membersOf: Map<string, Member[]>;
  depts: Dept[];
  positions: Pos[];
  branches: Option[];
  editable: boolean;
}) {
  const kids = childrenOf.get(dept.id) ?? [];
  const members = membersOf.get(dept.id) ?? [];
  return (
    <div className={depth > 0 ? "ml-4 border-l-2 border-border pl-3 mt-3" : ""}>
      <div className="card overflow-x-auto">
        <div className="panel-head">
          <h2>
            {dept.name} <span className="sub">{members.length}명</span>
          </h2>
        </div>
        {editable && (
          <div className="px-4 py-2 border-b border-border text-xs">
            <details>
              <summary className="cursor-pointer text-accent">부서 수정</summary>
              <ActionForm action={updateDepartment} className="mt-2 grid gap-1 max-w-[360px]">
                <input type="hidden" name="id" value={dept.id} />
                <DeptFields v={dept} depts={depts} branches={branches} idPrefix={`dept-${dept.id}`} />
                <SubmitButton className="btn btn-sm">저장</SubmitButton>
              </ActionForm>
              <ActionForm action={deleteDepartment} className="mt-2 mb-1">
                <input type="hidden" name="id" value={dept.id} />
                <SubmitButton className="btn btn-sm btn-danger">부서 삭제</SubmitButton>
              </ActionForm>
            </details>
          </div>
        )}
        <MemberTable members={members} positions={positions} depts={depts} editable={editable} />
      </div>
      {kids.map((k) => (
        <DeptNode key={k.id} dept={k} depth={depth + 1} childrenOf={childrenOf} membersOf={membersOf} depts={depts} positions={positions} branches={branches} editable={editable} />
      ))}
    </div>
  );
}

export default async function OrgPage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const editable = session.can("member.manage");
  const supabase = await createClient();

  const [{ data: departments }, { data: positionRows }, { data: memberRows }, branches] = await Promise.all([
    supabase.from("department").select("id, name, parent_id, branch_id, sort_order").eq("tenant_id", tid).is("deleted_at", null).order("sort_order").order("name"),
    supabase.from("job_position").select("id, name, rank").eq("tenant_id", tid).is("deleted_at", null).order("rank").order("sort_order").order("name"),
    supabase
      .from("membership")
      .select("id, profile_id, branch_id, department_id, position_id, job_title, profile:profile(display_name, email, phone), role:role(name)")
      .eq("tenant_id", tid)
      .eq("status", "active"),
    branchOptions(supabase, tid),
  ]);
  const depts = (departments ?? []) as Dept[];
  const positions = (positionRows ?? []) as Pos[];
  const members = (memberRows ?? []) as unknown as Member[];
  const deptIds = new Set(depts.map((d) => d.id));

  const childrenOf = new Map<string, Dept[]>();
  const roots: Dept[] = [];
  for (const d of depts) {
    if (d.parent_id && deptIds.has(d.parent_id)) childrenOf.set(d.parent_id, [...(childrenOf.get(d.parent_id) ?? []), d]);
    else roots.push(d);
  }
  const membersOf = new Map<string, Member[]>();
  const unassigned: Member[] = [];
  for (const m of members) {
    if (m.department_id && deptIds.has(m.department_id)) membersOf.set(m.department_id, [...(membersOf.get(m.department_id) ?? []), m]);
    else unassigned.push(m);
  }
  // 지점이 둘 이상이면 지점별로 묶어 보여준다 (공통 부서는 맨 앞, 운영 중지된 지점 소속은 공통으로)
  const multi = branches.length > 1;
  const known = new Set(branches.map((b) => b.id));
  const common = (branchId: string | null) => !branchId || !known.has(branchId);
  const groups: { key: string; label: string; roots: Dept[]; unassigned: Member[] }[] = multi
    ? [
        { key: "", label: "공통", roots: roots.filter((d) => common(d.branch_id)), unassigned: unassigned.filter((m) => common(m.branch_id)) },
        ...branches.map((b) => ({ key: b.id, label: b.name, roots: roots.filter((d) => d.branch_id === b.id), unassigned: unassigned.filter((m) => m.branch_id === b.id) })),
      ].filter((g) => g.roots.length > 0 || g.unassigned.length > 0)
    : [{ key: "", label: "", roots, unassigned }];
  const nodeProps = { childrenOf, membersOf, depts, positions, branches, editable };

  return (
    <div className={"grid gap-4 p-4 items-start" + (editable ? " lg:grid-cols-[1fr_340px]" : "")}>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>구성원 <b className="mono text-text">{members.length}</b>명</span>
          <span>부서 <b className="mono text-text">{depts.length}</b></span>
          <span>직위 <b className="mono text-text">{positions.length}</b></span>
        </div>
        {groups.map((g) => (
          <div key={g.key} className="grid gap-3">
            {multi && <h2 className="text-sm font-semibold text-muted">{g.label}</h2>}
            {g.roots.map((d) => (
              <DeptNode key={d.id} dept={d} depth={0} {...nodeProps} />
            ))}
            {g.unassigned.length > 0 && (
              <div className="card overflow-x-auto">
                <div className="panel-head">
                  <h2>
                    미배정 <span className="sub">{g.unassigned.length}명</span>
                  </h2>
                </div>
                <MemberTable members={g.unassigned} positions={positions} depts={depts} editable={editable} />
              </div>
            )}
          </div>
        ))}
        {depts.length === 0 && members.length === 0 && <p className="text-sm text-muted">구성원이 없습니다. 설정 &gt; 구성원에서 초대해 주세요.</p>}
      </div>

      {editable && (
        <div className="grid gap-4">
          <ActionForm action={createDepartment} className="card p-4">
            <h2 className="text-sm font-semibold mb-3">부서 추가</h2>
            <DeptFields v={{ branch_id: multi ? session.current.branch_id : null }} depts={depts} branches={branches} idPrefix="dept-new" />
            <SubmitButton className="btn">부서 추가</SubmitButton>
          </ActionForm>

          <div className="card">
            <div className="panel-head">
              <h2>
                직위 <span className="sub">{positions.length}</span>
              </h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>이름</th>
                  <th className="text-right">순위</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.name}</td>
                    <td className="num">{p.rank}</td>
                    <td>
                      <details>
                        <summary className="cursor-pointer text-accent text-xs">수정</summary>
                        <ActionForm action={updatePosition} className="mt-2 grid gap-1">
                          <input type="hidden" name="id" value={p.id} />
                          <input name="name" required maxLength={30} defaultValue={p.name} className="field" aria-label="직위 이름" />
                          <input name="rank" type="number" min={0} max={999} defaultValue={p.rank} className="field mono" aria-label="순위" />
                          <SubmitButton className="btn btn-sm">저장</SubmitButton>
                        </ActionForm>
                      </details>
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-muted">직위가 없습니다. 아래에서 추가해 주세요.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <ActionForm action={createPosition} className="p-4 border-t border-border">
              <div className="grid grid-cols-[1fr_88px] gap-x-2">
                <div className="form-row">
                  <label className="label" htmlFor="pos-name">직위 이름<span className="req">*</span></label>
                  <input id="pos-name" name="name" required maxLength={30} placeholder="대표 / 팀장 / 사원" className="field" />
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="pos-rank">순위</label>
                  <input id="pos-rank" name="rank" type="number" min={0} max={999} defaultValue={0} className="field mono" />
                </div>
              </div>
              <p className="text-xs text-muted mb-2">순위가 작을수록 위에 보입니다.</p>
              <SubmitButton className="btn btn-sm">직위 추가</SubmitButton>
            </ActionForm>
          </div>
        </div>
      )}
    </div>
  );
}
