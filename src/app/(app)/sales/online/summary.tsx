import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { addDays } from "@/lib/dates";
import { autoCostFor, labelsFor, ledgerIn, outcomesIn } from "@/lib/online/report";
import { computeMoney, costPerWon, ratioTone, spendRatio } from "@/lib/online/money";
import { MAX_DAYS } from "@/lib/online/period";

/** 영업 분석 화면의 온라인 성과 요약 — 전환 결과 합계와 계약당 광고비. 계산은 /sales/online 과 같다(홈페이지 기록 없이 붙인 결과만으로). */
export async function OnlineSummary({ tenantId, from: fromIn, to }: { tenantId: string; from: string; to: string }) {
  const from = fromIn < addDays(to, -(MAX_DAYS - 1)) ? addDays(to, -(MAX_DAYS - 1)) : fromIn;
  const db = await createClient();
  const [outcomes, ledger, labels, cost] = await Promise.all([outcomesIn(db, tenantId, from, to), ledgerIn(db, tenantId, from, to), labelsFor(db, tenantId), autoCostFor(tenantId, from, to)]);
  const count = { won: 0, valid: 0, none: 0 };
  for (const o of outcomes) count[o.outcome]++;
  const { total } = computeMoney(outcomes.map((o) => ({ ...o, amount: o.amount == null ? null : Number(o.amount) })), ledger, cost.auto);
  const cpa = costPerWon(total);
  const ratio = spendRatio(total);
  const tone = ratioTone(ratio);
  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold mb-1 flex items-baseline justify-between">
        온라인 전환 결과 <Link href={`/sales/online?from=${from}&to=${to}`} className="text-xs text-accent font-normal">온라인 성과 →</Link>
      </h2>
      <p className="text-xs text-muted mb-3">홈페이지 전화·카톡·견적폼 누름에 붙인 결과(누른 날 기준). 광고비 부가세 별도, 매출 공급가.</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {labels.map((l) => (
          <div key={l.key} className="border border-border rounded-[3px] p-2">
            <div className="text-xs text-muted">{l.name}</div>
            <div className="text-lg font-bold num">{count[l.key]}<span className="text-xs text-muted font-normal ml-1">건</span></div>
          </div>
        ))}
      </div>
      <table className="tbl">
        <tbody>
          <tr><td>광고비</td><td className="num text-right">{total.spend ? `${won(total.spend)}원` : "—"}{!cost.auto && <span className="text-xs text-muted ml-1">(자동 기록 없음)</span>}</td></tr>
          <tr><td>매출</td><td className="num text-right">{total.revenue ? `${won(total.revenue)}원` : "—"}</td></tr>
          <tr><td>계약당 광고비</td><td className="num text-right font-semibold">{cpa == null ? "—" : `${won(cpa)}원`}</td></tr>
          <tr><td>광고비 비율</td><td className={`num text-right ${tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : ""}`}>{ratio == null ? "—" : `${ratio}%`}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
