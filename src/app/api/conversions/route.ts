// 온라인 성과 — 홈페이지 전환(전화·카톡·견적폼 누름) 한 건마다 실제 결과를 붙이고, 광고비 대비 매출을 채널별로 본다.
// 화면은 /sales/online. 표는 supabase/migrations/20261008001600_online_performance.sql.
//
// GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD (한국 날짜, 기본 최근 30일, 최대 366일)
//      → { from, to, labels, total, open, byChannel[], rows[], money: { channels[], total, ledger[], costDays, costAvailable, costUpdated } }
// POST { event_id, outcome: 'won'|'valid'|'none'|null, note?, amount?, contract_no? }
//      → 결과 붙이기. null 이면 줄을 지운다(= 미확인). won 이 아니면 금액·계약 연결은 지운다.
//        contract_no 를 주면 이 사업체 계약에 잇고, 금액이 비어 있으면 계약 금액 ÷ 1.1(공급가)로 채운다.
// PUT  { labels: [{ key, name, description }] } → 단계 이름 바꾸기 (conversion.labels)
import { apiAuth, dbError, json, readJson } from "@/lib/online/api";
import { buildReport, shapeReport } from "@/lib/online/report";
import { clampPeriod } from "@/lib/online/period";
import { sourceFor } from "@/lib/online/sources";
import { getEvent, isEventId } from "@/lib/online/events";
import { OUTCOME_KEYS, PHONE_LIKE, isOutcomeKey, mergeLabels } from "@/lib/online/channels";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await apiAuth("conversion.read");
  if (!a.ok) return a.res;
  const sp = new URL(req.url).searchParams;
  const { from, to } = clampPeriod(sp.get("from"), sp.get("to"));
  return json(shapeReport(await buildReport(a.db, a.tid, from, to), a.session.can("conversion.labels")));
}

export async function POST(req: Request) {
  const a = await apiAuth("conversion.write");
  if (!a.ok) return a.res;
  const b = await readJson(req);
  const id = String(b?.event_id ?? "");
  if (!isEventId(id)) return json({ error: "전환 번호가 없습니다." }, 400);
  const outcome = b?.outcome == null || b.outcome === "" ? null : b.outcome;
  if (outcome !== null && !isOutcomeKey(outcome)) return json({ error: "결과는 세 단계 중 하나여야 합니다." }, 400);
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 300) : undefined;
  if (note && PHONE_LIKE.test(note)) return json({ error: "메모에 전화번호를 적지 마세요." }, 400);
  let amount: number | null | undefined;
  if (b && "amount" in b) {
    if (b.amount == null || b.amount === "") amount = null;
    else {
      amount = Math.round(Number(b.amount));
      if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000_000) return json({ error: "계약 금액은 0 이상 숫자여야 합니다." }, 400);
    }
  }
  const contractNo = typeof b?.contract_no === "string" ? b.contract_no.trim().toUpperCase().slice(0, 30) : undefined;

  const { data: cur } = await a.db
    .from("conversion_outcome")
    .select("id, outcome, note, amount, contract_id")
    .eq("tenant_id", a.tid).eq("source", "site").eq("event_id", id)
    .maybeSingle();

  if (!outcome) {
    // 결과를 지우면 미확인으로 돌아간다. 메모·금액은 결과에 딸려 있어 같이 사라진다.
    if (cur) {
      const { error } = await a.db.from("conversion_outcome").delete().eq("id", cur.id);
      if (error) return json({ error: dbError(error.code, "지우지 못했습니다.") }, 502);
    }
    return json({ ok: true, event_id: id, outcome: null, note: "", amount: null, contract: null });
  }

  // 계약 연결
  let contract: { id: string; no: string } | null | undefined;
  let suggested: number | null = null;
  if (outcome !== "won") contract = null;
  else if (contractNo === "") contract = null;
  else if (contractNo) {
    if (!a.session.can("contract.read")) return json({ error: "계약 조회 권한이 있어야 계약을 붙일 수 있습니다." }, 403);
    const { data: c } = await a.db.from("contract_summary").select("id, contract_no, sale_total").eq("tenant_id", a.tid).eq("contract_no", contractNo).maybeSingle();
    if (!c) return json({ error: `계약 ${contractNo} 을(를) 찾지 못했습니다.` }, 404);
    contract = { id: c.id, no: c.contract_no };
    suggested = Math.round(Number(c.sale_total) / 1.1); // 계약 금액은 부가세 포함 → 공급가
  }

  const patch: Record<string, unknown> = { outcome };
  if (note !== undefined) patch.note = note || null;
  if (contract !== undefined) patch.contract_id = contract?.id ?? null;
  if (outcome !== "won") patch.amount = null;
  else if (amount !== undefined) patch.amount = amount;
  else if (suggested != null && (cur?.amount == null || cur.outcome !== "won")) patch.amount = suggested;

  let saved;
  if (cur) {
    saved = await a.db.from("conversion_outcome").update(patch).eq("id", cur.id)
      .select("event_id, outcome, note, amount, updated_at, contract:contract_id(id, contract_no)").single();
  } else {
    // 처음 붙일 때만 홈페이지 기록을 확인하고 시각·종류·채널을 같이 적어 둔다
    const ev = await getEvent(sourceFor(a.tid), id).catch(() => undefined);
    if (ev === undefined) return json({ error: "홈페이지 전환 기록을 읽지 못했습니다. 잠시 뒤 다시 눌러 주세요." }, 502);
    if (!ev) return json({ error: "그 전환을 찾지 못했습니다." }, 404);
    saved = await a.db.from("conversion_outcome")
      .insert({ tenant_id: a.tid, source: "site", event_id: id, event_at: ev.at, event_type: ev.type, channel: ev.channel, ...patch })
      .select("event_id, outcome, note, amount, updated_at, contract:contract_id(id, contract_no)").single();
  }
  if (saved.error || !saved.data) return json({ error: dbError(saved.error?.code) }, 400);
  const d = saved.data as unknown as { outcome: string; note: string | null; amount: number | null; updated_at: string; contract: { id: string; contract_no: string } | null };
  return json({
    ok: true, event_id: id, outcome: d.outcome, note: d.note ?? "", amount: d.amount == null ? null : Number(d.amount),
    contract: d.contract ? { id: d.contract.id, no: d.contract.contract_no } : null,
    setBy: a.session.profile?.display_name ?? null, setAt: d.updated_at,
  });
}

export async function PUT(req: Request) {
  const a = await apiAuth("conversion.labels");
  if (!a.ok) return a.res;
  const b = await readJson(req);
  const list = Array.isArray(b?.labels) ? (b.labels as Array<Record<string, unknown>>) : [];
  const clean = list
    .filter((l) => isOutcomeKey(l?.key))
    .map((l) => ({ key: String(l.key), name: String(l.name ?? "").trim().slice(0, 20), description: String(l.description ?? "").trim().slice(0, 120) || null }));
  if (!clean.length || clean.some((l) => !l.name)) return json({ error: "단계 이름을 비워 둘 수 없습니다." }, 400);
  const merged = mergeLabels(clean);
  if (new Set(merged.map((l) => l.name)).size !== merged.length) return json({ error: "단계 이름이 서로 달라야 합니다." }, 400);
  const { error } = await a.db.from("conversion_label").upsert(
    clean.map((l) => ({ tenant_id: a.tid, ...l, sort: OUTCOME_KEYS.indexOf(l.key as (typeof OUTCOME_KEYS)[number]) + 1 })),
    { onConflict: "tenant_id,key" },
  );
  if (error) return json({ error: dbError(error.code) }, 400);
  return json({ ok: true, labels: merged });
}
