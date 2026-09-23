import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createBranch, updateBranch } from "@/lib/actions/settings";

export const metadata = { title: "지점" };

type Branch = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  is_hq: boolean;
  status: "active" | "inactive";
};

export default async function BranchesPage() {
  const session = await requireTenant();
  const supabase = await createClient();
  const { data } = await supabase
    .from("branch")
    .select("id, code, name, phone, address, is_hq, status")
    .eq("tenant_id", session.current.tenant_id)
    .is("deleted_at", null)
    .order("is_hq", { ascending: false })
    .order("sort_order")
    .order("created_at");
  const branches = (data ?? []) as Branch[];
  const editable = session.can("branch.manage");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] items-start">
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>코드</th>
              <th>지점</th>
              <th>전화</th>
              <th>주소</th>
              <th>상태</th>
              {editable && <th></th>}
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.code}</td>
                <td className="font-semibold">
                  {b.name} {b.is_hq && <span className="badge badge-run ml-1">본사</span>}
                </td>
                <td className="mono">{b.phone ?? <span className="zero">—</span>}</td>
                <td className="text-muted">{b.address ?? "—"}</td>
                <td>
                  <span className={"badge " + (b.status === "active" ? "badge-done" : "badge-wait")}>
                    {b.status === "active" ? "운영" : "중지"}
                  </span>
                </td>
                {editable && (
                  <td>
                    <details>
                      <summary className="cursor-pointer text-accent text-xs">수정</summary>
                      <ActionForm action={updateBranch} className="mt-2 grid gap-2 min-w-[260px]">
                        <input type="hidden" name="id" value={b.id} />
                        <input name="name" defaultValue={b.name} required maxLength={40} className="field" placeholder="지점 이름" />
                        <input name="phone" defaultValue={b.phone ?? ""} maxLength={30} className="field mono" placeholder="전화" />
                        <input name="address" defaultValue={b.address ?? ""} maxLength={120} className="field" placeholder="주소" />
                        <select name="status" defaultValue={b.status} className="field">
                          <option value="active">운영</option>
                          <option value="inactive">중지</option>
                        </select>
                        <SubmitButton className="btn btn-sm">저장</SubmitButton>
                      </ActionForm>
                    </details>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={editable ? 6 : 5}>{branches.length}개 지점</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {editable && (
        <ActionForm action={createBranch} className="card p-4">
          <h2 className="text-sm font-semibold mb-3">지점 추가</h2>
          <div className="form-row">
            <label className="label" htmlFor="code">코드<span className="req">*</span></label>
            <input id="code" name="code" required pattern="[A-Za-z0-9_-]{1,12}" placeholder="예: DG" className="field mono" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="bname">이름<span className="req">*</span></label>
            <input id="bname" name="name" required maxLength={40} placeholder="예: 대구지점" className="field" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="bphone">전화</label>
            <input id="bphone" name="phone" maxLength={30} className="field mono" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="baddress">주소</label>
            <input id="baddress" name="address" maxLength={120} className="field" />
          </div>
          <SubmitButton>추가</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
