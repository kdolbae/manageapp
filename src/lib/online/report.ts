// 온라인 성과 한 화면치 자료. /sales/online 첫 화면과 GET /api/conversions 가 같이 쓴다.
// 결과·직접 기록은 로그인 사용자 권한(RLS)으로 이 시스템 DB 에서, 전환 이벤트·자동 광고비는 ./sources.ts 연결로 읽는다.
import { memberOptions, type Db } from "@/app/(app)/people/data";
import { sourceFor } from "./sources";
import { loadEvents, type EventRow } from "./events";
import { loadCosts, sumCosts } from "./adcost";
import { computeMoney, type AutoCost, type LedgerRow, type MoneyRow } from "./money";
import { CHANNELS, CHANNEL_LABEL, mergeLabels, type Channel, type OutcomeKey, type OutcomeLabel } from "./channels";
import { kstBounds } from "./period";

export type OutcomeRow = {
  event_id: string;
  channel: Channel;
  event_at: string;
  outcome: OutcomeKey;
  amount: number | null;
  note: string | null;
  contract: { id: string; no: string } | null;
  setBy: string | null;
  setAt: string;
};

export type Report = {
  from: string;
  to: string;
  labels: OutcomeLabel[];
  connected: { events: boolean; ads: boolean };
  eventsError: string | null;
  events: EventRow[];
  outcomes: OutcomeRow[];
  ledger: LedgerRow[];
  auto: AutoCost | null;
  costUpdated: string | null;
  money: { channels: MoneyRow[]; total: MoneyRow };
};

type DbOutcome = {
  event_id: string; channel: Channel; event_at: string; outcome: OutcomeKey; amount: number | null; note: string | null;
  contract_id: string | null; set_by: string | null; updated_at: string; contract: { contract_no: string } | null;
};

export async function outcomesIn(db: Db, tenantId: string, from: string, to: string): Promise<DbOutcome[]> {
  const { gte, lt } = kstBounds(from, to);
  const { data } = await db
    .from("conversion_outcome")
    .select("event_id, channel, event_at, outcome, amount, note, contract_id, set_by, updated_at, contract:contract_id(contract_no)")
    .eq("tenant_id", tenantId)
    .eq("source", "site")
    .gte("event_at", gte)
    .lt("event_at", lt)
    .limit(10000);
  return (data ?? []) as unknown as DbOutcome[];
}

export async function ledgerIn(db: Db, tenantId: string, from: string, to: string): Promise<LedgerRow[]> {
  const { data } = await db
    .from("ad_spend_ledger")
    .select("id, kind, day, channel, amount, note")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .gte("day", from)
    .lte("day", to)
    .order("day", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  return ((data ?? []) as LedgerRow[]).map((l) => ({ ...l, amount: Number(l.amount) }));
}

export async function labelsFor(db: Db, tenantId: string): Promise<OutcomeLabel[]> {
  const { data } = await db.from("conversion_label").select("key, name, description").eq("tenant_id", tenantId);
  return mergeLabels((data ?? []) as { key: string; name: string; description: string | null }[]);
}

/** 자동 광고비만 (영업 분석 요약용) */
export async function autoCostFor(tenantId: string, from: string, to: string): Promise<{ auto: AutoCost | null; updated: string | null; connected: boolean }> {
  const src = sourceFor(tenantId);
  const costs = await loadCosts(src);
  return { auto: costs ? sumCosts(costs, from, to) : null, updated: costs?.updated ?? null, connected: !!src.ads };
}

export async function buildReport(db: Db, tenantId: string, from: string, to: string): Promise<Report> {
  const src = sourceFor(tenantId);
  const { gte, lt } = kstBounds(from, to);
  let eventsError: string | null = null;
  const [events, outcomes, ledger, labels, cost, members] = await Promise.all([
    loadEvents(src, gte, lt).catch((e) => {
      console.error("[online] events", e);
      eventsError = "홈페이지 전환 기록을 읽지 못했습니다.";
      return [] as EventRow[];
    }),
    outcomesIn(db, tenantId, from, to),
    ledgerIn(db, tenantId, from, to),
    labelsFor(db, tenantId),
    autoCostFor(tenantId, from, to),
    memberOptions(db, tenantId),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const rows: OutcomeRow[] = outcomes.map((o) => ({
    event_id: o.event_id,
    channel: o.channel,
    event_at: o.event_at,
    outcome: o.outcome,
    amount: o.amount == null ? null : Number(o.amount),
    note: o.note,
    contract: o.contract_id ? { id: o.contract_id, no: o.contract?.contract_no ?? "(조회 권한 없음)" } : null,
    setBy: o.set_by ? nameOf.get(o.set_by) ?? null : null,
    setAt: o.updated_at,
  }));
  return {
    from,
    to,
    labels,
    connected: { events: !!src.events, ads: cost.connected },
    eventsError,
    events,
    outcomes: rows,
    ledger,
    auto: cost.auto,
    costUpdated: cost.updated,
    money: computeMoney(rows, ledger, cost.auto),
  };
}

export type ChannelSum = { key: Channel; label: string; total: number; open: number; won: number; valid: number; none: number };
export type ConvRow = EventRow & {
  outcome: OutcomeKey | null;
  note: string;
  amount: number | null;
  contract: { id: string; no: string } | null;
  setBy: string | null;
  setAt: string | null;
};
export type Payload = ReturnType<typeof shapeReport>;

/** 전환 목록에 결과를 붙이고 채널 × 결과 합계를 낸다. GET /api/conversions 응답이자 화면 첫 자료. */
export function shapeReport(r: Report, canEditLabels: boolean) {
  const oBy = new Map(r.outcomes.map((o) => [o.event_id, o]));
  const sum = new Map<Channel, ChannelSum>();
  const rows: ConvRow[] = r.events.map((e) => {
    const o = oBy.get(e.id);
    const s = sum.get(e.channel) ?? sum.set(e.channel, { key: e.channel, label: CHANNEL_LABEL[e.channel], total: 0, open: 0, won: 0, valid: 0, none: 0 }).get(e.channel)!;
    s.total++;
    s[o ? o.outcome : "open"]++;
    return { ...e, outcome: o?.outcome ?? null, note: o?.note ?? "", amount: o?.amount ?? null, contract: o?.contract ?? null, setBy: o?.setBy ?? null, setAt: o?.setAt ?? null };
  });
  return {
    from: r.from,
    to: r.to,
    labels: r.labels,
    canEditLabels,
    connected: r.connected,
    eventsError: r.eventsError,
    total: rows.length,
    open: rows.filter((x) => !x.outcome).length,
    byChannel: CHANNELS.map((k) => sum.get(k)).filter((x): x is ChannelSum => !!x),
    rows,
    // 기간 안 결과 전부(목록에서 빠진 내부 기기 건 포함) — 광고비 대비 매출은 이것으로 센다
    outcomes: r.outcomes.map((o) => ({ event_id: o.event_id, channel: o.channel, outcome: o.outcome, amount: o.amount })),
    money: {
      ...r.money,
      ledger: r.ledger,
      auto: r.auto,
      costDays: r.auto ? Math.max(r.auto.naver.days, r.auto.meta.days) : 0,
      costAvailable: !!r.auto,
      costUpdated: r.costUpdated,
    },
  };
}
