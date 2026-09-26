import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues, labelOf } from "@/lib/codes";
import { phone, shortDate } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createCustomer } from "@/lib/actions/people";
import { branchOptions, memberOptions, partnerOptions } from "../data";
import { NoPermission } from "../shared";
import { CustomerFields } from "./customer-fields";

export const metadata = { title: "고객" };

const LIMIT = 100;

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  source_code: string | null;
  marketing_consent: boolean;
  created_at: string;
  owner: { display_name: string } | null;
  site: { id: string }[] | null;
};

export default async function CustomersPage({ searchParams }: PageProps<"/people/customers">) {
  const session = await requireTenant();
  if (!session.can("customer.read")) return <NoPermission what="고객" />;
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const editable = session.can("customer.write");

  const sp = await searchParams;
  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = (rawQ ?? "").trim().slice(0, 40);

  let query = supabase
    .from("customer")
    .select(
      "id, name, phone, source_code, marketing_consent, created_at, owner:profile!owner_id(display_name), site(id)",
      { count: "exact" },
    )
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .is("site.deleted_at", null);
  if (q) {
    // 이름은 부분 일치, 숫자가 3자리 이상이면 전화번호(숫자만 저장됨)도 같이 찾는다.
    const safe = q.replace(/[,()"'\\]/g, "");
    const digits = q.replace(/\D/g, "");
    const parts = safe ? [`name.ilike.%${safe}%`] : [];
    if (digits.length >= 3) parts.push(`phone.ilike.%${digits}%`, `phone2.ilike.%${digits}%`);
    if (parts.length) query = query.or(parts.join(","));
  }

  const [{ data, count }, sources, partners, branches, members] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(LIMIT),
    codeValues(tid, "customer_source"),
    editable ? partnerOptions(supabase, tid, ["referrer", "orderer"]) : [],
    editable ? branchOptions(supabase, tid) : [],
    editable ? memberOptions(supabase, tid) : [],
  ]);
  const rows = (data ?? []) as unknown as CustomerRow[];
  const total = count ?? rows.length;
  const owner = {
    id: session.user.id,
    name: session.profile?.display_name || session.user.email || "나",
    locked: session.current.scope === "own",
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="grid gap-3">
        <form method="get" className="flex gap-2 items-center">
          <input
            name="q"
            defaultValue={q}
            maxLength={40}
            placeholder="이름 또는 전화번호"
            aria-label="고객 검색"
            className="field max-w-[280px]"
          />
          <button type="submit" className="btn">검색</button>
          {q && (
            <Link href="/people/customers" className="btn">
              지우기
            </Link>
          )}
        </form>

        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>이름</th>
                <th>전화</th>
                <th className="num">현장</th>
                <th>유입 경로</th>
                <th>담당자</th>
                <th>마케팅</th>
                <th>등록일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="font-semibold">
                    <Link href={`/people/customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="mono">{c.phone ? phone(c.phone) : <span className="zero">—</span>}</td>
                  <td className="num">{c.site?.length ? c.site.length : <span className="zero">0</span>}</td>
                  <td>{labelOf(sources, c.source_code) || <span className="zero">—</span>}</td>
                  <td>{c.owner?.display_name ?? <span className="zero">—</span>}</td>
                  <td>
                    {c.marketing_consent ? (
                      <span className="badge badge-done">동의</span>
                    ) : (
                      <span className="badge badge-wait">미동의</span>
                    )}
                  </td>
                  <td className="mono text-muted">{shortDate(c.created_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-6">
                    {q ? "검색 결과가 없습니다." : "등록된 고객이 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>
                  {total > rows.length ? `${total}명 중 최근 ${rows.length}명 표시` : `${rows.length}명`}
                  {q && ` · 검색: ${q}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {editable && (
        <ActionForm action={createCustomer} className="card p-4">
          <h2 className="text-sm font-semibold mb-3">고객 등록</h2>
          <CustomerFields
            v={{ owner_id: session.user.id, branch_id: session.current.branch_id }}
            sources={sources}
            partners={partners}
            branches={branches}
            members={members}
            owner={owner}
            idPrefix="cust-new"
          />
          <SubmitButton>등록</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
