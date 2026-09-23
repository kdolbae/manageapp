import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/inbox";
import { REQUEST_STATUS, categoryLabels, platformCategories } from "@/lib/market";
import { Chips, EmptyRow, RevealContact, StatusBadge } from "../shared";
import { REQUEST_SELECT, filterParam, nowIso, platformVendors, quotesFor, statusCounts, type ServiceRequest, vendorName, vendorNameMap } from "../data";

export const metadata = { title: "요청·견적" };

const FILTERS = ["all", "open", "accepted", "closed", "canceled"] as const;

export default async function RequestsPage({ searchParams }: PageProps<"/platform/requests">) {
  await requireTenant();
  const sp = await searchParams;
  const filter = filterParam(sp.s, FILTERS, "all");
  const supabase = await createClient();
  const base = supabase.from("service_request").select(REQUEST_SELECT);
  const [{ data }, vendors, cats, counts] = await Promise.all([
    (filter === "all" ? base : base.eq("status", filter)).order("created_at", { ascending: false }).limit(200),
    platformVendors(supabase),
    platformCategories(supabase, false),
    statusCounts(supabase, "service_request", ["open", "accepted", "closed", "canceled"]),
  ]);
  const reqs = (data ?? []) as ServiceRequest[];
  const quotes = await quotesFor(supabase, reqs.map((r) => r.id));
  const names = vendorNameMap(vendors);
  const now = nowIso();

  return (
    <div>
      <Chips
        base="/platform/requests"
        param="s"
        value={filter}
        items={[
          { key: "all", label: "전체" },
          { key: "open", label: "견적 받는 중", count: counts.open },
          { key: "accepted", label: "업체 선택됨", count: counts.accepted },
          { key: "closed", label: "마감", count: counts.closed },
          { key: "canceled", label: "취소", count: counts.canceled },
        ]}
      />
      <div className="p-4">
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>접수</th>
                <th>고객</th>
                <th>지역 · 단지</th>
                <th>분류</th>
                <th className="text-right">견적</th>
                <th>선택 업체</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {reqs.map((r) => {
                const qs = quotes.filter((q) => q.request_id === r.id);
                const accepted = qs.find((q) => q.status === "accepted");
                const expired = r.status === "open" && r.expires_at < now;
                return (
                  <tr key={r.id}>
                    <td className="mono text-xs whitespace-nowrap">
                      <Link href={`/platform/requests/${r.id}`}>{fmtDateTime(r.created_at)}</Link>
                    </td>
                    <td><RevealContact name={r.name} phone={r.phone} email={r.email} /></td>
                    <td>
                      <Link href={`/platform/requests/${r.id}`} className="font-semibold text-text no-underline">
                        {r.region}
                        {r.apt ? ` · ${r.apt}` : ""}
                      </Link>
                      {r.directed_tenant_id && <div className="text-xs text-muted">지목: {vendorName(names, r.directed_tenant_id)}</div>}
                    </td>
                    <td className="text-xs">{categoryLabels(r.categories, cats) || "—"}</td>
                    <td className={`num ${qs.length ? "" : "zero"}`}>{qs.length}</td>
                    <td className="text-xs">{accepted ? vendorName(names, accepted.tenant_id) : <span className="text-muted">—</span>}</td>
                    <td>
                      <StatusBadge s={REQUEST_STATUS[r.status]} fallback={r.status} />
                      {expired && <span className="text-xs text-muted ml-1">기한 지남</span>}
                    </td>
                  </tr>
                );
              })}
              {reqs.length === 0 && <EmptyRow cols={7}>해당하는 요청이 없습니다.</EmptyRow>}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>{reqs.length}건{reqs.length === 200 ? " (최근 200건만)" : ""} · 고객 이름·전화는 운영자만 봅니다. 업체에는 이름 일부와 단지까지만 보이고, 전화번호는 고객이 선택한 업체에 공개를 켰을 때만 보입니다.</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
