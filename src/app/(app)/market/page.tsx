import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { MARKET_REQUEST_SELECT, QUOTE_STATUS, REQUEST_STATUS, categoryLabels, platformCategories, type MarketRequest } from "@/lib/market";
import { deadlineText, myQuotes, requestTitle } from "./data";

export const metadata = { title: "견적 요청" };

const FILTERS = [
  { key: "", label: "전체" },
  { key: "quoted", label: "견적 낸 것" },
  { key: "accepted", label: "선택된 것" },
] as const;

export default async function MarketRequestsPage({ searchParams }: PageProps<"/market">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const filter = sp.f === "quoted" || sp.f === "accepted" ? sp.f : "";
  const supabase = await createClient();
  const now = new Date().toISOString();

  const [{ data: rows }, cats] = await Promise.all([
    supabase.from("market_request").select(MARKET_REQUEST_SELECT).order("created_at", { ascending: false }).limit(200),
    platformCategories(supabase, false),
  ]);
  const list = (rows ?? []) as MarketRequest[];
  const quotes = await myQuotes(supabase, tid, list.map((r) => r.id));
  const quoteOf = new Map(quotes.map((q) => [q.request_id, q]));
  const acceptedCount = list.filter((r) => r.accepted_tenant_id === tid).length;
  const shown = list.filter((r) => (filter === "quoted" ? quoteOf.has(r.id) : filter === "accepted" ? r.accepted_tenant_id === tid : true));
  const countOf = (key: string) => (key === "quoted" ? quoteOf.size : key === "accepted" ? acceptedCount : list.length);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        {FILTERS.map((c) => (
          <Link key={c.key} href={c.key ? `/market?f=${c.key}` : "/market"} className={`chip ${filter === c.key ? "is-active" : ""}`}>
            {c.label}
            <span className="mono text-[11px] text-muted">{countOf(c.key)}</span>
          </Link>
        ))}
        <span className="ml-auto text-xs text-muted">이름 일부·단지까지만 보입니다. 연락처는 고객이 우리를 선택하면 열립니다.</span>
      </div>
      <div className="p-4">
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>고객</th>
                <th>지역 · 단지</th>
                <th>분류</th>
                <th className="text-right">평수</th>
                <th>입주일</th>
                <th>상태</th>
                <th>내 견적</th>
                <th>마감</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = REQUEST_STATUS[r.status] ?? { label: r.status, badge: "wait" as const };
                const q = quoteOf.get(r.id);
                const qs = q ? (QUOTE_STATUS[q.status] ?? { label: q.status, badge: "wait" as const }) : null;
                const mineAccepted = r.accepted_tenant_id === tid;
                const deadline = deadlineText(r, now);
                return (
                  <tr key={r.id} className={mineAccepted ? "is-selected" : ""}>
                    <td>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link href={`/market/requests/${r.id}`} className={"text-text no-underline " + (q ? "font-medium" : "font-bold")}>{r.name_masked}</Link>
                        {r.directed_tenant_id === tid && <span className="badge badge-run">우리 지목</span>}
                      </div>
                    </td>
                    <td className="text-xs"><Link href={`/market/requests/${r.id}`} className="text-text no-underline">{requestTitle(r)}</Link></td>
                    <td className="text-xs">{categoryLabels(r.categories, cats) || <span className="zero">—</span>}</td>
                    <td className={`num ${r.area_pyeong ? "" : "zero"}`}>{r.area_pyeong ? `${r.area_pyeong}평` : "—"}</td>
                    <td className="mono text-xs whitespace-nowrap">{r.move_in_date ?? <span className="zero">—</span>}</td>
                    <td><span className={`badge badge-${mineAccepted ? "done" : st.badge}`}>{mineAccepted ? "우리 선택됨" : st.label}</span></td>
                    <td className="text-xs whitespace-nowrap">
                      {q && qs ? (
                        <>
                          <span className="mono">{won(q.amount)}원</span> · <span className={`badge badge-${qs.badge}`}>{qs.label}</span>
                        </>
                      ) : (
                        <span className="text-muted">견적 없음</span>
                      )}
                    </td>
                    <td className={"mono text-xs whitespace-nowrap " + (deadline.startsWith("D-") || deadline === "오늘 마감" ? "" : "text-muted")}>{deadline || "—"}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted">
                    {filter === "quoted"
                      ? "아직 낸 견적이 없습니다."
                      : filter === "accepted"
                        ? "아직 고객이 우리를 선택한 요청이 없습니다."
                        : "지금 볼 수 있는 요청이 없습니다. 업체 소개의 분류·지역과 맞는 요청이 오면 알림이 옵니다."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8}>{shown.length}건 · 최근 요청 순 · 열린 요청은 마감(보통 14일)까지 견적을 낼 수 있습니다</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
