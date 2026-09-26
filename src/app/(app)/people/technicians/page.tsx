import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { phone } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createTechnician } from "@/lib/actions/people";
import { branchOptions, memberOptions } from "../data";
import { NoPermission, RATE_LABEL, StatusBadge, WorkAreaTags } from "../shared";
import { TechnicianFields } from "./technician-fields";

export const metadata = { title: "시공자" };

type TechnicianRow = {
  id: string;
  name: string;
  phone: string | null;
  skills: string[] | null;
  rate_type: string;
  status: string;
  profile_id: string | null;
  branch: { name: string } | null;
  profile: { display_name: string } | null;
};

export default async function TechniciansPage() {
  const session = await requireTenant();
  if (!session.can("technician.read")) return <NoPermission what="시공자" />;
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const editable = session.can("technician.write");

  const [{ data }, areas, branches, members] = await Promise.all([
    supabase
      .from("technician")
      .select("id, name, phone, skills, rate_type, status, profile_id, branch:branch(name), profile:profile(display_name)")
      .eq("tenant_id", tid)
      .is("deleted_at", null)
      .order("status")
      .order("sort_order")
      .order("name"),
    codeValues(tid, "work_area"),
    editable ? branchOptions(supabase, tid) : [],
    editable ? memberOptions(supabase, tid, "technician") : [],
  ]);
  const rows = (data ?? []) as unknown as TechnicianRow[];
  const linked = new Set(rows.map((t) => t.profile_id).filter((p): p is string => !!p));
  const active = rows.filter((t) => t.status === "active").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>이름</th>
              <th>전화</th>
              <th>지점</th>
              <th>기술</th>
              <th>정산 방식</th>
              <th>상태</th>
              <th>앱 계정</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="font-semibold">
                  <Link href={`/people/technicians/${t.id}`}>{t.name}</Link>
                </td>
                <td className="mono">{t.phone ? phone(t.phone) : <span className="zero">—</span>}</td>
                <td>{t.branch?.name ?? <span className="zero">—</span>}</td>
                <td>
                  <WorkAreaTags codes={t.skills ?? []} values={areas} />
                </td>
                <td>{RATE_LABEL[t.rate_type] ?? t.rate_type}</td>
                <td>
                  <StatusBadge status={t.status} />
                </td>
                <td>
                  {t.profile ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="badge badge-run">연결</span>
                      <span className="text-muted text-xs">{t.profile.display_name}</span>
                    </span>
                  ) : (
                    <span className="zero">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-6">
                  등록된 시공자가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}>
                {rows.length}명 · 활동 {active}명
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <ActionForm action={createTechnician} className="card p-4">
          <h2 className="text-sm font-semibold mb-3">시공자 등록</h2>
          <TechnicianFields
            v={{ branch_id: session.current.branch_id, rate_type: "rate_3_3" }}
            branches={branches}
            skills={areas}
            members={members}
            linked={linked}
            idPrefix="tech-new"
          />
          <SubmitButton>등록</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
