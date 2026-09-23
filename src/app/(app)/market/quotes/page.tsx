import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { shortDate, won } from "@/lib/format";
import { QUOTE_STATUS, categoryLabels, platformCategories } from "@/lib/market";
import { myQuotes, requestTitle, requestsByIds } from "../data";

export const metadata = { title: "내 견적" };

export default async function MyQuotesPage({ searchParams }: PageProps<"/market/quotes">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const status = typeof sp.s === "string" && Object.hasOwn(QUOTE_STATUS, sp.s) ? sp.s : "";
  const supabase = await createClient();

  const [quotes, cats] = await Promise.all([myQuotes(supabase, tid), platformCategories(supabase, false)]);
  // 뷰(market_request)는 FK 가 없어 임베드가 안 되므로 요청 요약은 따로 가져와 붙인다
  const requests = await requestsByIds(supabase, Array.from(new Set(quotes.map((q) => q.request_id))));
  const reqOf = new Map(requests.map((r) => [r.id, r]));
  const shown = status ? quotes.filter((q) => q.status === status) : quotes;
  const countOf = (s: string) => (s ? quotes.filter((q) => q.status === s).length : quotes.length);
  const accepted = quotes.filter((q) => q.status === "accepted");
  const decided = quotes.filter((q) => q.status === "accepted" || q.status === "declined").length;
  const converted = accepted.filter((q) => q.contract_id).length;
  const acceptedTotal = accepted.reduce((s, q) => s + Number(q.amount), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        <Link href="/market/quotes" className={`chip ${status ? "" : "is-active"}`}>
          전체 <span className="mono text-[11px] text-muted">{countOf("")}</span>
        </Link>
        {Object.entries(QUOTE_STATUS).map(([k, v]) => (
          <Link key={k} href={`/market/quotes?s=${k}`} className={`chip ${status === k ? "is-active" : ""}`}>
            {v.label} <span className="mono text-[11px] text-muted">{countOf(k)}</span>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 p-4">
        <div className="card grid grid-cols-2 md:grid-cols-4">
          <div className="stat"><div className="k">낸 견적</div><div className={`v ${quotes.length ? "" : "zero"}`}>{quotes.length}</div></div>
          <div className="stat"><div className="k">선택됨</div><div className={`v ${accepted.length ? "" : "zero"}`}>{accepted.length}<span className="text-xs text-muted font-normal ml-1">{decided ? `${Math.round((accepted.length / decided) * 100)}%` : ""}</span></div></div>
          <div className="stat"><div className="k">계약 전환</div><div className={`v ${converted ? "" : "zero"}`}>{converted}</div></div>
          <div className="stat"><div className="k">선택된 금액</div><div className={`v ${acceptedTotal ? "" : "zero"}`}>{won(acceptedTotal)}</div></div>
        </div>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>요청</th>
                <th>분류</th>
                <th className="text-right">금액</th>
                <th>상태</th>
                <th>시공 가능일</th>
                <th>제출일</th>
                <th>계약</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((q) => {
                const r = reqOf.get(q.request_id);
                const st = QUOTE_STATUS[q.status] ?? { label: q.status, badge: "wait" as const };
                return (
                  <tr key={q.id} className={q.status === "accepted" ? "is-selected" : ""}>
                    <td>
                      <Link href={`/market/requests/${q.request_id}`} className="text-text no-underline font-medium">
                        {r ? `${r.name_masked} · ${requestTitle(r)}` : "요청 (더 이상 보이지 않음)"}
                      </Link>
                      {r?.move_in_date && <div className="text-xs text-muted mono">입주 {r.move_in_date}</div>}
                    </td>
                    <td className="text-xs">{r ? categoryLabels(r.categories, cats) || <span className="zero">—</span> : "—"}</td>
                    <td className="num">{won(q.amount)}</td>
                    <td><span className={`badge badge-${st.badge}`}>{st.label}</span></td>
                    <td className="mono text-xs whitespace-nowrap">{q.available_from ?? <span className="zero">—</span>}</td>
                    <td className="mono text-xs text-muted whitespace-nowrap">{shortDate(q.created_at)}</td>
                    <td className="text-xs whitespace-nowrap">
                      {q.contract_id ? (
                        <Link href={`/contracts/${q.contract_id}`}>계약 보기</Link>
                      ) : q.status === "accepted" ? (
                        <Link href={`/market/requests/${q.request_id}`} className="btn btn-sm btn-primary">계약으로 만들기</Link>
                      ) : (
                        <span className="zero">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted">{status ? `${QUOTE_STATUS[status]?.label ?? status} 상태의 견적이 없습니다.` : "아직 낸 견적이 없습니다. 요청 탭에서 맞는 요청을 골라 견적을 내 보세요."}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>{shown.length}건 · 최근 제출 순</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
