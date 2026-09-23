import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { phone } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createPartner } from "@/lib/actions/people";
import { branchOptions } from "../data";
import { CodeBadges, NoPermission, PARTNER_STATUS, StatusBadge, rateText } from "../shared";
import { PartnerFields } from "./partner-fields";

export const metadata = { title: "협력업체" };

type PartnerRow = {
  id: string;
  name: string;
  types: string[] | null;
  phone: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  commission_rate: number | string | null;
  status: string;
  branch: { name: string } | null;
};

export default async function PartnersPage() {
  const session = await requireTenant();
  if (!session.can("partner.read")) return <NoPermission what="협력업체" />;
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const editable = session.can("partner.write");

  const [{ data }, types, branches] = await Promise.all([
    supabase
      .from("partner")
      .select("id, name, types, phone, contact_name, contact_phone, commission_rate, status, branch:branch(name)")
      .eq("tenant_id", tid)
      .is("deleted_at", null)
      .order("status")
      .order("name"),
    codeValues(tid, "partner_type"),
    editable ? branchOptions(supabase, tid) : [],
  ]);
  const rows = (data ?? []) as unknown as PartnerRow[];
  const active = rows.filter((p) => p.status === "active").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>업체명</th>
              <th>유형</th>
              <th>담당자 · 연락처</th>
              <th className="num">수수료율</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const tel = p.contact_phone || p.phone;
              return (
                <tr key={p.id}>
                  <td className="font-semibold">
                    <Link href={`/people/partners/${p.id}`}>{p.name}</Link>
                    {p.branch && <div className="text-xs text-muted font-normal">{p.branch.name}</div>}
                  </td>
                  <td>
                    <CodeBadges codes={p.types ?? []} values={types} />
                  </td>
                  <td>
                    {p.contact_name || tel ? (
                      <>
                        {p.contact_name}
                        {p.contact_name && tel && " · "}
                        {tel && <span className="mono">{phone(tel)}</span>}
                      </>
                    ) : (
                      <span className="zero">—</span>
                    )}
                  </td>
                  <td className="num">{rateText(p.commission_rate) || <span className="zero">—</span>}</td>
                  <td>
                    <StatusBadge status={p.status} labels={PARTNER_STATUS} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-6">
                  등록된 협력업체가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                {rows.length}곳 · 거래 중 {active}곳
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <ActionForm action={createPartner} className="card p-4">
          <h2 className="text-sm font-semibold mb-3">협력업체 등록</h2>
          <PartnerFields v={{ branch_id: session.current.branch_id }} types={types} branches={branches} idPrefix="partner-new" />
          <SubmitButton>등록</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
