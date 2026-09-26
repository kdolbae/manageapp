// 광고비 대비 매출 계산. 서버(첫 화면·영업 분석 요약)와 브라우저(결과를 바꾼 뒤 바로 다시 계산)가 같이 쓴다 — 서버 전용 import 금지.
//
//   광고비      = 자동 광고비(그 채널, 기간 안 날짜 합) + 직접 기록 spend
//   계약 건수   = 결과가 won 인 전환 수
//   매출        = won 전환의 금액 합 + 직접 기록 revenue
//   매출÷광고비 = 매출 / 광고비            (광고비 0 이면 null)
//   광고비 비율 = 광고비 / 매출 × 100      (매출 0 이면 null) — 30% 이하 좋음, 50% 초과 나쁨
//   계약당 광고비 = 광고비 / 계약 건수     (계약 0 이면 null)
import { CHANNELS, CHANNEL_LABEL, type Channel } from "./channels";

export type AutoCost = { naver: { cost: number; days: number }; meta: { cost: number; days: number }; days: number };
export type LedgerRow = { id: string; kind: "revenue" | "spend"; day: string; channel: Channel; amount: number; note: string | null };
export type WonRow = { channel: Channel; outcome: string | null; amount: number | null };

export type MoneyRow = {
  key: Channel | "total";
  label: string;
  spend: number;
  spendAuto: number;
  spendManual: number;
  won: number;
  wonWithAmount: number;
  revenue: number;
  revenueEvents: number;
  revenueLedger: number;
};

const blank = (key: Channel | "total", label: string): MoneyRow => ({ key, label, spend: 0, spendAuto: 0, spendManual: 0, won: 0, wonWithAmount: 0, revenue: 0, revenueEvents: 0, revenueLedger: 0 });

export function computeMoney(rows: WonRow[], ledger: LedgerRow[], auto: AutoCost | null): { channels: MoneyRow[]; total: MoneyRow } {
  const by = new Map<Channel, MoneyRow>();
  const mk = (k: Channel) => by.get(k) ?? by.set(k, blank(k, CHANNEL_LABEL[k])).get(k)!;
  if (auto?.naver.days) mk("inNaverAd").spendAuto = auto.naver.cost;
  if (auto?.meta.days) mk("inMeta").spendAuto = auto.meta.cost;
  for (const r of rows) {
    if (r.outcome !== "won") continue;
    const m = mk(r.channel);
    m.won++;
    if (r.amount) {
      m.wonWithAmount++;
      m.revenueEvents += r.amount;
    }
  }
  for (const l of ledger) {
    const m = mk(l.channel);
    if (l.kind === "spend") m.spendManual += l.amount;
    else m.revenueLedger += l.amount;
  }
  const channels = CHANNELS.map((k) => by.get(k))
    .filter((m): m is MoneyRow => !!m)
    .map((m) => ({ ...m, spend: m.spendAuto + m.spendManual, revenue: m.revenueEvents + m.revenueLedger }))
    .filter((m) => m.spend || m.revenue || m.won);
  const total = blank("total", "합계");
  for (const m of channels) {
    for (const k of ["spend", "spendAuto", "spendManual", "won", "wonWithAmount", "revenue", "revenueEvents", "revenueLedger"] as const) total[k] += m[k];
  }
  return { channels, total };
}

/** 매출÷광고비 (소수 한 자리) */
export const roas = (m: MoneyRow) => (m.spend ? Math.round((m.revenue / m.spend) * 10) / 10 : null);
/** 광고비 비율 % */
export const spendRatio = (m: MoneyRow) => (m.revenue ? Math.round((m.spend / m.revenue) * 100) : null);
/** 계약당 광고비 */
export const costPerWon = (m: MoneyRow) => (m.won ? Math.round(m.spend / m.won) : null);
export const ratioTone = (r: number | null) => (r == null ? "" : r <= 30 ? "good" : r > 50 ? "bad" : "");

export const spendSource = (m: MoneyRow) => (m.spendAuto && m.spendManual ? "자동+직접" : m.spendAuto ? "자동" : m.spendManual ? "직접 기록" : "");
export const revenueSource = (m: MoneyRow) => (m.revenueEvents && m.revenueLedger ? "계약 금액+직접" : m.revenueEvents ? "계약 금액" : m.revenueLedger ? "직접 기록" : "");
