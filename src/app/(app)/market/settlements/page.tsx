import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { fmtDateTime } from "@/lib/inbox";
import { todayKST } from "@/lib/dates";
import { monthLabel, monthRange } from "@/lib/groupware";
import { FEE_CYCLE, FEE_TYPE, SETTLEMENT_STATUS, feeFor, type PlatformFee } from "@/lib/market";

export const metadata = { title: "집대리 정산" };

type Fee = PlatformFee & { cycle: string; memo: string | null; updated_at: string };
type Line = { id: string; kind: string; ref_type: string | null; ref_id: string | null; description: string; basis_amount: number; fee_amount: number; created_at: string };
type Settlement = {
  id: string;
  period_from: string;
  period_to: string;
  status: string;
  fee_total: number;
  ad_total: number;
  adjust_total: number;
  total: number;
  issued_at: string | null;
  paid_at: string | null;
  memo: string | null;
  created_at: string;
  lines: Line[] | null;
};
type ContractRow = { id: string; contract_no: string; customer_name: string | null; contract_date: string; sale_total: number };
const LINE_KIND: Record<string, string> = { fee: "수수료", ad: "광고", adjust: "조정" };

/** 수수료 규칙 한 줄: 계약금액 10% · 건당 30,000원 · 없음 */
function feeRule(fee: Fee): string {
  if (fee.fee_type === "percent") return `계약금액의 ${Number(fee.rate)}%`;
  if (fee.fee_type === "fixed") return `건당 ${won(fee.fixed_amount)}원`;
  return "없음";
}

export default async function SettlementsPage() {
  const session = await requireTenant();
  if (!session.can("market.settle")) return <p className="p-4 text-sm text-muted">집대리 정산을 볼 수 있는 권한(market.settle)이 없습니다.</p>;
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const month = todayKST().slice(0, 7);
  const { start, end } = monthRange(month);

  const [{ data: feeRow }, { data: setRows }, { data: quoteRows }] = await Promise.all([
    supabase.from("platform_fee").select("fee_type, rate, fixed_amount, min_fee, max_fee, cycle, memo, updated_at").eq("tenant_id", tid).maybeSingle(),
    supabase
      .from("platform_settlement")
      .select("id, period_from, period_to, status, fee_total, ad_total, adjust_total, total, issued_at, paid_at, memo, created_at, lines:platform_settlement_line(id, kind, ref_type, ref_id, description, basis_amount, fee_amount, created_at)")
      .eq("tenant_id", tid)
      .order("period_from", { ascending: false })
      .limit(100),
    supabase.from("quote").select("id, contract_id").eq("tenant_id", tid).eq("status", "accepted").not("contract_id", "is", null),
  ]);
  const fee = (feeRow ?? null) as Fee | null;
  const settlements = ((setRows ?? []) as unknown as Settlement[]).map((s) => ({
    ...s,
    lines: [...(s.lines ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
  // 이번 달 계약일의 플랫폼 계약(견적 → 계약)에 수수료 규칙을 적용한 예상치. 정산서 함수(build_platform_settlement)와 같은 규칙.
  const contractIds = ((quoteRows ?? []) as { contract_id: string | null }[]).map((q) => q.contract_id).filter((v): v is string => Boolean(v));
  const { data: conRows } = contractIds.length
    ? await supabase
        .from("contract_summary")
        .select("id, contract_no, customer_name, contract_date, sale_total")
        .in("id", contractIds)
        .gte("contract_date", start)
        .lte("contract_date", end)
        .is("canceled_at", null)
        .order("contract_date")
    : { data: [] as ContractRow[] };
  const settledRefs = new Set(settlements.filter((s) => s.status !== "void").flatMap((s) => s.lines.filter((l) => l.ref_type === "contract" && l.ref_id).map((l) => l.ref_id as string)));
  const estimate = ((conRows ?? []) as ContractRow[]).map((c) => ({ ...c, fee: fee ? feeFor(fee, Number(c.sale_total)) : 0, settled: settledRefs.has(c.id) }));
  const estimateTotal = estimate.filter((e) => !e.settled).reduce((s, e) => s + e.fee, 0);
  const unpaid = settlements.filter((s) => s.status === "issued").reduce((s, x) => s + Number(x.total), 0);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px] items-start">
      <div className="grid gap-4">
        <div className="card">
          <div className="panel-head">
            <h2>
              정산서 <span className="sub">{settlements.length}건</span>
            </h2>
            {unpaid > 0 && <span className="badge badge-run">입금 대기 {won(unpaid)}원</span>}
          </div>
          {settlements.length === 0 && <p className="p-4 text-sm text-muted">아직 정산서가 없습니다. 집대리 운영자가 기간을 정해 만들면 여기 쌓이고, 발행되면 알림이 옵니다.</p>}
          <div className="divide-y divide-border">
            {settlements.map((s) => {
              const st = SETTLEMENT_STATUS[s.status] ?? { label: s.status, badge: "wait" as const };
              return (
                <details key={s.id}>
                  <summary className="cursor-pointer px-4 py-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="mono">{s.period_from} ~ {s.period_to}</span>
                    <span className={`badge badge-${st.badge}`}>{st.label}</span>
                    <span className="ml-auto mono font-semibold">{won(s.total)}원</span>
                    <span className="text-xs text-accent">항목 보기</span>
                  </summary>
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 border border-border rounded-sm mb-3">
                      <div className="stat"><div className="k">수수료</div><div className={`v ${Number(s.fee_total) ? "" : "zero"}`}>{won(s.fee_total)}</div></div>
                      <div className="stat"><div className="k">광고</div><div className={`v ${Number(s.ad_total) ? "" : "zero"}`}>{won(s.ad_total)}</div></div>
                      <div className="stat"><div className="k">조정</div><div className={`v ${Number(s.adjust_total) ? "" : "zero"}`}>{won(s.adjust_total)}</div></div>
                      <div className="stat"><div className="k">합계</div><div className="v">{won(s.total)}</div></div>
                    </div>
                    <div className="text-xs text-muted mb-2 flex flex-wrap gap-x-3">
                      <span>만든 날 <span className="mono">{fmtDateTime(s.created_at)}</span></span>
                      {s.issued_at && <span>발행 <span className="mono">{fmtDateTime(s.issued_at)}</span></span>}
                      {s.paid_at && <span>입금 <span className="mono">{fmtDateTime(s.paid_at)}</span></span>}
                      {s.memo && <span>{s.memo}</span>}
                    </div>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>구분</th>
                          <th>내용</th>
                          <th className="text-right">기준 금액</th>
                          <th className="text-right">수수료</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.lines.map((l) => (
                          <tr key={l.id}>
                            <td className="text-xs">{LINE_KIND[l.kind] ?? l.kind}</td>
                            <td className="text-xs">
                              {l.ref_type === "contract" && l.ref_id ? <Link href={`/contracts/${l.ref_id}`} className="text-text">{l.description}</Link> : l.description}
                            </td>
                            <td className={`num ${Number(l.basis_amount) ? "" : "zero"}`}>{Number(l.basis_amount) ? won(l.basis_amount) : "—"}</td>
                            <td className="num">{won(l.fee_amount)}</td>
                          </tr>
                        ))}
                        {s.lines.length === 0 && (
                          <tr>
                            <td colSpan={4} className="text-muted">항목이 없습니다.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">우리 업체 수수료</h2>
          {fee ? (
            <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 gap-x-3 text-sm">
              <dt className="text-muted">방식</dt>
              <dd>{FEE_TYPE[fee.fee_type] ?? fee.fee_type}</dd>
              <dt className="text-muted">계산</dt>
              <dd>{feeRule(fee)}</dd>
              {(fee.min_fee != null || fee.max_fee != null) && (
                <>
                  <dt className="text-muted">최소·최대</dt>
                  <dd className="mono">{fee.min_fee != null ? `${won(fee.min_fee)}원` : "—"} ~ {fee.max_fee != null ? `${won(fee.max_fee)}원` : "—"}</dd>
                </>
              )}
              <dt className="text-muted">주기</dt>
              <dd>{FEE_CYCLE[fee.cycle] ?? fee.cycle}</dd>
              {fee.memo && (
                <>
                  <dt className="text-muted">메모</dt>
                  <dd className="text-xs">{fee.memo}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted">수수료 설정 전 — 집대리 운영자가 정하면 여기 표시됩니다.</p>
          )}
          <p className="text-xs text-muted mt-3">집대리 요청에서 만든 계약(견적 → 계약)만 수수료 대상입니다. 우리가 직접 받은 계약에는 붙지 않습니다.</p>
        </div>

        <div className="card">
          <div className="panel-head">
            <h2>
              예상 수수료 <span className="sub">{monthLabel(month)}</span>
            </h2>
            <span className={`mono text-sm font-semibold ${estimateTotal ? "" : "text-muted"}`}>{won(estimateTotal)}원</span>
          </div>
          <ul className="divide-y divide-border">
            {estimate.map((c) => (
              <li key={c.id} className="px-4 py-2.5 text-sm flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Link href={`/contracts/${c.id}`} className="text-text no-underline font-medium mono text-xs">{c.contract_no}</Link>
                  <span className="text-xs text-muted ml-1.5">{c.customer_name ?? ""} · {c.contract_date.slice(5).replace("-", ".")} · {won(c.sale_total)}원</span>
                </div>
                {c.settled ? <span className="badge badge-done">정산됨</span> : <span className="mono text-xs">{won(c.fee)}</span>}
              </li>
            ))}
            {estimate.length === 0 && <li className="px-4 py-3 text-xs text-muted">이번 달 계약일의 집대리 계약이 없습니다.</li>}
          </ul>
          <p className="px-4 py-2.5 text-xs text-muted border-t border-border">이번 달 계약일 기준, 취소되지 않은 집대리 계약에 위 규칙을 적용한 예상치입니다. 실제 금액은 운영자가 만든 정산서를 따릅니다.</p>
        </div>
      </div>
    </div>
  );
}
