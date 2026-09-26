"use client";

// 온라인 성과 화면. 첫 자료는 서버가 넘기고, 결과·금액·직접 기록을 바꾸면 이 화면에서 바로 다시 계산한다(재조회 없음).
// 전화번호·이름은 받지도 보여 주지도 않는다(전화기 기록은 서버가 가운데를 가려서 준다).
import { useEffect, useMemo, useState } from "react";
import { won } from "@/lib/format";
import { todayKST } from "@/lib/dates";
import { CHANNELS, CHANNEL_LABEL, PHONE_LIKE, type Channel, type OutcomeKey, type OutcomeLabel } from "@/lib/online/channels";
import { computeMoney, costPerWon, ratioTone, revenueSource, roas, spendRatio, spendSource, type LedgerRow, type MoneyRow } from "@/lib/online/money";
import type { ChannelSum, ConvRow, Payload } from "@/lib/online/report";

const TYPE: Record<string, string> = { call: "전화", kakao: "카톡", form: "견적폼" };
const FILTER_KEY = "jip-online-filter";
type Filter = { outcome: string; type: string; channel: string };
type Won = { event_id: string; channel: Channel; outcome: OutcomeKey; amount: number | null };

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000);
const p2 = (n: number) => String(n).padStart(2, "0");
const hms = (iso: string) => {
  const k = kst(iso);
  return `${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}:${p2(k.getUTCSeconds())}`;
};
const dayKey = (iso: string) => kst(iso).toISOString().slice(0, 10);
const dayHead = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${"일월화수목금토"[d.getUTCDay()]})`;
};
const pretty = (p: string | null) => {
  try {
    return decodeURIComponent(p || "/");
  } catch {
    return p || "/";
  }
};

async function call<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: j as T } : { ok: false, error: (j as { error?: string }).error || "저장하지 못했습니다." };
  } catch {
    return { ok: false, error: "연결이 끊겼습니다." };
  }
}

export function OnlineBoard({ initial, canWrite, canLinkContract }: { initial: Payload; canWrite: boolean; canLinkContract: boolean }) {
  const [rows, setRows] = useState<ConvRow[]>(initial.rows);
  const [wons, setWons] = useState<Won[]>(initial.outcomes);
  const [ledger, setLedger] = useState<LedgerRow[]>(initial.money.ledger);
  const [labels, setLabels] = useState<OutcomeLabel[]>(initial.labels);
  const [F, setF] = useState<Filter>({ outcome: "open", type: "", channel: "" });
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  // 방금 결과를 고른 건은 필터(예: 미확인)에서 벗어나도 필터를 바꿀 때까지 그 자리에 둔다 — 금액·메모를 이어서 적을 수 있게.
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에 기억한 필터는 첫 그리기 뒤에만 읽을 수 있다
      if (s && typeof s === "object") setF((f) => ({ ...f, ...s }));
    } catch {}
  }, []);
  const setFilter = (patch: Partial<Filter>) => {
    setPinned(new Set());
    setF((f) => {
      const n = { ...f, ...patch };
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(n));
      } catch {}
      return n;
    });
  };

  const money = useMemo(() => computeMoney(wons, ledger, initial.money.auto), [wons, ledger, initial.money.auto]);
  const byChannel = useMemo(() => {
    const m = new Map<Channel, ChannelSum>();
    for (const r of rows) {
      const s = m.get(r.channel) ?? m.set(r.channel, { key: r.channel, label: CHANNEL_LABEL[r.channel], total: 0, open: 0, won: 0, valid: 0, none: 0 }).get(r.channel)!;
      s.total++;
      s[r.outcome ?? "open"]++;
    }
    return CHANNELS.map((k) => m.get(k)).filter((x): x is ChannelSum => !!x);
  }, [rows]);
  const visible = rows.filter(
    (r) => pinned.has(r.id) || (F.outcome === "" || (F.outcome === "open" ? !r.outcome : r.outcome === F.outcome)) && (!F.type || r.type === F.type) && (!F.channel || r.channel === F.channel),
  );
  const labelOf = (k: string) => labels.find((l) => l.key === k)?.name ?? k;

  // 결과·메모·금액·계약 저장. 같은 단추를 다시 누르면 미확인으로 돌린다.
  async function save(id: string, patch: { outcome?: OutcomeKey | null; note?: string; amount?: number | null; contract_no?: string }) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    if (patch.note && PHONE_LIKE.test(patch.note)) {
      setMsg({ text: "메모에 전화번호를 적지 마세요.", err: true });
      return;
    }
    const outcome = "outcome" in patch ? patch.outcome! : r.outcome;
    const body: Record<string, unknown> = { event_id: id, outcome, note: patch.note ?? r.note };
    if ("amount" in patch) body.amount = patch.amount;
    if ("contract_no" in patch) body.contract_no = patch.contract_no;
    const before = { rows, wons };
    setPinned((p) => (p.has(id) ? p : new Set(p).add(id)));
    const optimistic: ConvRow = { ...r, outcome, note: outcome ? (patch.note ?? r.note) : "", amount: outcome === "won" ? ("amount" in patch ? patch.amount! : r.amount) : null, contract: outcome === "won" ? r.contract : null };
    apply(optimistic);
    const res = await call<{ outcome: OutcomeKey | null; note: string; amount: number | null; contract: ConvRow["contract"]; setBy: string | null; setAt: string | null }>("/api/conversions", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      setRows(before.rows);
      setWons(before.wons);
      setMsg({ text: `${res.error} 다시 눌러 주세요.`, err: true });
      return;
    }
    const d = res.data;
    apply({ ...r, outcome: d.outcome, note: d.note, amount: d.amount, contract: d.contract, setBy: d.outcome ? d.setBy : null, setAt: d.outcome ? d.setAt : null });
    setMsg({ text: d.outcome ? `${hms(r.at)} ${TYPE[r.type]} → ${labelOf(d.outcome)}${d.contract ? ` · 계약 ${d.contract.no}` : ""}${d.amount ? ` · ${won(d.amount)}원` : ""} 저장` : `${hms(r.at)} ${TYPE[r.type]} → 미확인으로 되돌림` });
  }
  function apply(n: ConvRow) {
    setRows((list) => list.map((x) => (x.id === n.id ? n : x)));
    setWons((list) => {
      const rest = list.filter((w) => w.event_id !== n.id);
      return n.outcome ? [...rest, { event_id: n.id, channel: n.channel, outcome: n.outcome, amount: n.amount }] : rest;
    });
  }

  // 자동 광고비가 잡힌 채널과 날 수 — 자동 기록이 기간 일부만 덮을 때 오해하지 않게 표 아래에 적는다
  const auto = initial.money.auto;
  const autoChannels: Channel[] = auto ? ([auto.naver.days ? "inNaverAd" : null, auto.meta.days ? "inMeta" : null].filter(Boolean) as Channel[]) : [];
  const autoNote = !initial.connected.ads || !auto
    ? "자동 기록 없음 — 광고비는 아래 직접 기록만 셉니다."
    : `자동 광고비(광고 도구 기록): ${[auto.naver.days ? `네이버 광고 ${auto.naver.days}일치` : "", auto.meta.days ? `메타 광고 ${auto.meta.days}일치` : ""].filter(Boolean).join(" · ") || "이 기간에는 없음"}.`;

  let lastDay = "";
  const counts = new Map<string, number>();
  for (const r of visible) counts.set(dayKey(r.at), (counts.get(dayKey(r.at)) ?? 0) + 1);

  return (
    <div className="p-4 grid gap-4 [&>*]:min-w-0">
      <p className="text-xs text-muted">
        홈페이지에서 전화·카톡·견적폼을 누른 기록에 실제 결과를 붙이면, 채널별로 계약 건수·매출·계약당 광고비가 나옵니다. 매출은 공급가, 광고비는 부가세 별도입니다. 날짜는 한국 시각입니다.
      </p>
      {msg && <p className={`notice ${msg.err ? "notice-danger" : "notice-success"}`} role="status">{msg.text}</p>}

      <MoneyTable money={money} from={initial.from} to={initial.to} autoNote={autoNote} />
      <LedgerBox ledger={ledger} canWrite={canWrite} autoChannels={autoChannels} onAdd={(row) => setLedger((l) => [row, ...l])} onDelete={(id) => setLedger((l) => l.filter((x) => x.id !== id))} setMsg={setMsg} />

      <section className="card">
        <div className="px-4 pt-3 pb-2 flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold">전환 결과</h2>
          <span className="text-xs text-muted">전환 {rows.length}건 · 미확인 {rows.filter((r) => !r.outcome).length}건</span>
        </div>
        {!initial.connected.events ? (
          <p className="px-4 pb-4 text-sm text-muted">이 사업체는 홈페이지 전환 기록이 아직 연결되지 않았습니다. 연결은 배포 설정(ONLINE_SOURCES)에서 합니다. 광고비·매출 직접 기록은 지금도 쓸 수 있습니다.</p>
        ) : initial.eventsError ? (
          <p className="px-4 pb-4 text-sm text-danger">{initial.eventsError} 잠시 뒤 다시 열어 주세요. 이미 붙인 결과와 금액은 위 표에 그대로 반영돼 있습니다.</p>
        ) : (
          <SumTable rows={byChannel} labels={labels} />
        )}
      </section>

      {initial.canEditLabels && <LabelEditor labels={labels} onSaved={setLabels} setMsg={setMsg} />}

      {initial.connected.events && !initial.eventsError && (
        <section>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Seg value={F.outcome} onChange={(v) => setFilter({ outcome: v })} options={[["open", "미확인"], ["", "전체"], ...labels.map((l) => [l.key, l.name] as [string, string])]} label="결과" />
            <Seg value={F.type} onChange={(v) => setFilter({ type: v })} options={[["", "모든 종류"], ["call", "전화"], ["kakao", "카톡"], ["form", "견적폼"]]} label="종류" />
            <select className="field h-8 text-xs w-auto" value={byChannel.some((c) => c.key === F.channel) ? F.channel : ""} onChange={(e) => setFilter({ channel: e.target.value })} aria-label="채널">
              <option value="">모든 채널</option>
              {byChannel.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">이 기간에는 전화·카톡·폼을 누른 기록이 없습니다.</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">{F.outcome === "open" ? "이 기간의 전환에 결과를 모두 붙였습니다." : "고른 조건에 맞는 전환이 없습니다."}</p>
          ) : (
            visible.map((r) => {
              const k = dayKey(r.at);
              const head = k !== lastDay ? (lastDay = k) : null;
              return (
                <div key={r.id}>
                  {head && <div className="mt-4 mb-1.5 text-[13px] font-bold">{dayHead(k)}<span className="text-xs text-muted font-normal ml-1.5">{counts.get(k)}건</span></div>}
                  <EventCard r={r} labels={labels} canWrite={canWrite} canLinkContract={canLinkContract} onSave={save} />
                </div>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}

function Seg({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-border rounded-[3px] overflow-hidden bg-surface">
      {options.map(([v, n], i) => (
        <button key={v || "_all"} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={`px-2.5 h-8 text-xs font-semibold ${i ? "border-l border-border" : ""} ${value === v ? "bg-accent text-white" : "text-muted"}`}>
          {n}
        </button>
      ))}
    </div>
  );
}

function MoneyTable({ money, from, to, autoNote }: { money: { channels: MoneyRow[]; total: MoneyRow }; from: string; to: string; autoNote: string }) {
  const rows = money.channels.length ? [...money.channels, money.total] : [];
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold mb-1">광고비 대비 매출 <span className="text-xs text-muted font-normal ml-1">{from} ~ {to} · 매출 공급가 · 광고비 부가세 별도</span></h2>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[640px]">
            <thead>
              <tr><th>채널</th><th className="text-right">광고비</th><th className="text-right">계약</th><th className="text-right">매출</th><th className="text-right">매출÷광고비</th><th className="text-right">광고비 비율</th><th className="text-right">계약당 광고비</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const ratio = spendRatio(m);
                const tone = ratioTone(ratio);
                const cpa = costPerWon(m);
                const x = roas(m);
                return (
                  <tr key={m.key} className={m.key === "total" ? "font-bold" : ""}>
                    <td>{m.label}</td>
                    <td className="num text-right">{m.spend ? `${won(m.spend)}원` : "—"}<Small>{spendSource(m)}</Small></td>
                    <td className="num text-right">{m.won}{m.won > m.wonWithAmount && <Small>금액 없는 계약 {m.won - m.wonWithAmount}</Small>}</td>
                    <td className="num text-right">{m.revenue ? `${won(m.revenue)}원` : "—"}<Small>{revenueSource(m)}</Small></td>
                    <td className="num text-right">{x == null ? "—" : `${x}배`}</td>
                    <td className={`num text-right ${tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : ""}`}>{ratio == null ? "—" : `${ratio}%`}</td>
                    <td className="num text-right">{cpa == null ? "—" : `${won(cpa)}원`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">이 기간에는 광고비·계약·매출 기록이 없습니다.</p>
      )}
      <p className="text-xs text-muted mt-2">
        {autoNote}{" "}
        매출은 계약 성사에 붙인 금액과 직접 기록의 합입니다. 광고비 비율 30% 이하는 초록, 50% 초과는 빨강입니다.
        <b className="font-semibold"> 같은 계약을 전환에 금액으로 붙였으면 직접 기록에 또 넣지 마세요(두 번 잡힙니다).</b>
      </p>
    </section>
  );
}

const Small = ({ children }: { children: React.ReactNode }) => (children ? <small className="block text-[11px] text-muted font-normal">{children}</small> : null);

function SumTable({ rows, labels }: { rows: ChannelSum[]; labels: OutcomeLabel[] }) {
  if (!rows.length) return <p className="px-4 pb-4 text-sm text-muted">이 기간에는 전환이 없습니다.</p>;
  const tot: ChannelSum = { key: "inOther", label: "합계", total: 0, open: 0, won: 0, valid: 0, none: 0 };
  for (const c of rows) for (const k of ["total", "open", "won", "valid", "none"] as const) tot[k] += c[k];
  const rate = (c: ChannelSum) => {
    const judged = c.won + c.valid + c.none;
    return judged ? `${Math.round((c.won / judged) * 1000) / 10}%` : "—";
  };
  return (
    <div className="overflow-x-auto px-4 pb-4">
      <table className="tbl min-w-[520px]">
        <thead>
          <tr><th>채널</th><th className="text-right">전환</th><th className="text-right">미확인</th>{labels.map((l) => <th key={l.key} className="text-right">{l.name}</th>)}<th className="text-right">{labels[0].name} 비율</th></tr>
        </thead>
        <tbody>
          {[...rows, tot].map((c, i) => (
            <tr key={i} className={i === rows.length ? "font-bold" : ""}>
              <td>{c.label}</td><td className="num text-right">{c.total}</td><td className="num text-right">{c.open}</td>
              {labels.map((l) => <td key={l.key} className="num text-right">{c[l.key]}</td>)}
              <td className="num text-right">{rate(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventCard({ r, labels, canWrite, canLinkContract, onSave }: { r: ConvRow; labels: OutcomeLabel[]; canWrite: boolean; canLinkContract: boolean; onSave: (id: string, p: { outcome?: OutcomeKey | null; note?: string; amount?: number | null; contract_no?: string }) => void }) {
  const where = r.landing && r.landing !== r.path ? `${pretty(r.landing)} → ${pretty(r.path)}` : pretty(r.path);
  const tone = r.outcome === "won" ? "border-l-success" : r.outcome === "valid" ? "border-l-accent" : r.outcome === "none" ? "border-l-muted" : "border-l-warn";
  return (
    <div className={`card border-l-4 ${tone} p-3 mb-1.5 grid gap-2 md:grid-cols-[88px_1fr_minmax(280px,360px)] items-start`}>
      <div>
        <div className="mono text-[15px] font-bold">{hms(r.at)}</div>
        <div className="text-xs text-muted">{TYPE[r.type] ?? r.type}</div>
      </div>
      <div className="text-[13px] grid gap-0.5 min-w-0">
        <div className="flex flex-wrap gap-x-2 items-baseline">
          <span className="badge badge-run">{r.channelLabel}</span>
          {r.keyword && <span><span className="text-muted text-xs">{r.channel === "inNaverAd" ? "검색어" : "광고"}</span> {r.keyword}</span>}
          <span className="text-xs text-muted">{[r.device, r.city].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="break-all"><span className="text-xs text-muted">누른 곳</span> {where}{r.label && <span className="text-xs text-muted"> ({r.label})</span>}</div>
        {r.call && <div className="text-xs">전화기 기록 {hms(r.call.at)} · <span className="mono">{r.call.phone}</span>{r.call.known ? " · 기존 고객" : ""}</div>}
      </div>
      <div className="grid gap-1.5">
        <div role="group" aria-label="결과" className="grid grid-cols-3 border border-border rounded-[3px] overflow-hidden">
          {labels.map((l, i) => (
            <button key={l.key} type="button" disabled={!canWrite} title={l.description ?? ""} aria-pressed={r.outcome === l.key}
              onClick={() => onSave(r.id, { outcome: r.outcome === l.key ? null : l.key })}
              className={`h-9 text-xs font-semibold ${i ? "border-l border-border" : ""} ${r.outcome === l.key ? "bg-accent text-white" : "bg-surface"}`}>
              {l.name}
            </button>
          ))}
        </div>
        {r.outcome === "won" && (
          <div className="grid grid-cols-2 gap-1.5">
            <input key={`a${r.amount}`} className="field h-9 num" type="number" min={0} step={10000} defaultValue={r.amount ?? ""} placeholder="계약 금액(공급가, 원)" aria-label="계약 금액" disabled={!canWrite}
              onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== r.amount) onSave(r.id, { amount: v }); }} />
            {canLinkContract ? (
              <input key={`c${r.contract?.no}`} className="field h-9 mono" defaultValue={r.contract?.no ?? ""} placeholder="계약번호 (C26-0012)" aria-label="계약번호" disabled={!canWrite}
                onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v !== (r.contract?.no ?? "")) onSave(r.id, { contract_no: v }); }} />
            ) : (
              <span className="text-xs text-muted self-center">{r.contract ? `계약 ${r.contract.no}` : ""}</span>
            )}
          </div>
        )}
        <input key={`n${r.outcome}${r.note}`} className="field h-9" defaultValue={r.note} maxLength={300} placeholder="메모 (예: 카톡 상담 → 견적 발송). 이름·전화번호 금지" aria-label="메모" disabled={!canWrite || !r.outcome}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== r.note) onSave(r.id, { note: v }); }} />
        {r.setBy && r.setAt && <div className="text-[11px] text-muted">{r.setBy} · {dayKey(r.setAt).slice(5).replace("-", ".")} {hms(r.setAt).slice(0, 5)}</div>}
      </div>
    </div>
  );
}

function LedgerBox({ ledger, canWrite, autoChannels, onAdd, onDelete, setMsg }: { ledger: LedgerRow[]; canWrite: boolean; autoChannels: Channel[]; onAdd: (r: LedgerRow) => void; onDelete: (id: string) => void; setMsg: (m: { text: string; err?: boolean }) => void }) {
  const [f, setF] = useState<{ kind: string; day: string; channel: string; amount: string; note: string }>({ kind: "spend", day: todayKST(), channel: CHANNELS.find((c) => c !== "inNaverAd" && !autoChannels.includes(c)) ?? "inOther", amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!f.day || f.amount === "") return setMsg({ text: "날짜와 금액을 넣어 주세요.", err: true });
    if (PHONE_LIKE.test(f.note)) return setMsg({ text: "메모에 전화번호를 적지 마세요.", err: true });
    setBusy(true);
    const res = await call<{ row: LedgerRow }>("/api/ad-ledger", { method: "POST", body: JSON.stringify(f) });
    setBusy(false);
    if (!res.ok) return setMsg({ text: res.error, err: true });
    onAdd(res.data.row);
    setF({ ...f, amount: "", note: "" });
    setMsg({ text: `${f.day} ${CHANNEL_LABEL[f.channel as Channel]} ${f.kind === "spend" ? "광고비" : "매출"} ${won(Number(f.amount))}원 기록` });
  }
  async function del(r: LedgerRow) {
    const res = await call("/api/ad-ledger?id=" + r.id, { method: "DELETE" });
    if (!res.ok) return setMsg({ text: res.error, err: true });
    onDelete(r.id);
    setMsg({ text: `${r.day} ${CHANNEL_LABEL[r.channel]} ${r.kind === "spend" ? "광고비" : "매출"} ${won(r.amount)}원 지움` });
  }
  return (
    <details className="card p-4" open={ledger.length > 0}>
      <summary className="text-sm font-semibold cursor-pointer">광고비·매출 직접 기록 <span className="text-xs text-muted font-normal">{ledger.length}건</span></summary>
      <p className="text-xs text-muted mt-2 mb-3">
        자동으로 안 오는 광고비와, 전환에 맞추지 못한 매출(전화로 바로 온 계약 등)만 적습니다.
        {autoChannels.length > 0 && <> {autoChannels.map((c) => CHANNEL_LABEL[c]).join("·")} 광고비는 자동으로 오니 적지 마세요.</>}
      </p>
      {canWrite && (
        <div className="flex flex-wrap gap-1.5 items-center mb-3">
          <select className="field h-9 w-auto" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류"><option value="spend">광고비</option><option value="revenue">매출</option></select>
          <input className="field h-9 w-[140px]" type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} aria-label="날짜" />
          <select className="field h-9 w-auto" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} aria-label="채널">{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select>
          <input className="field h-9 w-[140px] num" type="number" min={0} step={1000} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="금액(원)" aria-label="금액" />
          <input className="field h-9 flex-1 min-w-[160px]" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="메모 (이름·전화번호 금지)" aria-label="메모" />
          <button type="button" className="btn btn-sm btn-primary h-9" onClick={add} disabled={busy}>{busy ? "기록 중…" : "기록"}</button>
        </div>
      )}
      {ledger.length ? (
        <table className="tbl">
          <tbody>
            {ledger.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.day}</td><td>{CHANNEL_LABEL[r.channel]}</td><td>{r.kind === "spend" ? "광고비" : "매출"}</td>
                <td className="num text-right font-semibold">{won(r.amount)}원</td><td className="text-muted">{r.note}</td>
                <td className="text-right">{canWrite && <button type="button" className="btn btn-sm btn-danger" onClick={() => del(r)}>지우기</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted">이 기간에 직접 기록한 것이 없습니다.</p>
      )}
    </details>
  );
}

function LabelEditor({ labels, onSaved, setMsg }: { labels: OutcomeLabel[]; onSaved: (l: OutcomeLabel[]) => void; setMsg: (m: { text: string; err?: boolean }) => void }) {
  const [draft, setDraft] = useState(labels);
  const [busy, setBusy] = useState(false);
  async function saveLabels() {
    setBusy(true);
    const res = await call<{ labels: OutcomeLabel[] }>("/api/conversions", { method: "PUT", body: JSON.stringify({ labels: draft }) });
    setBusy(false);
    if (!res.ok) return setMsg({ text: res.error, err: true });
    onSaved(res.data.labels);
    setMsg({ text: "단계 이름을 저장했습니다." });
  }
  return (
    <details className="card p-4">
      <summary className="text-sm font-semibold cursor-pointer">결과 단계 이름 바꾸기</summary>
      <p className="text-xs text-muted mt-2 mb-3">단계는 셋으로 고정이고 이름·설명만 바꿉니다. 이미 붙인 결과는 그대로 따라갑니다.</p>
      <div className="grid gap-1.5">
        {draft.map((l, i) => (
          <div key={l.key} className="grid grid-cols-[48px_160px_1fr] gap-1.5 items-center">
            <span className="text-xs text-muted">{i + 1}단계</span>
            <input className="field h-9" value={l.name} maxLength={20} aria-label={`${i + 1}단계 이름`} onChange={(e) => setDraft(draft.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))} />
            <input className="field h-9" value={l.description ?? ""} maxLength={120} placeholder="언제 이 단계를 고르는지" aria-label={`${i + 1}단계 설명`} onChange={(e) => setDraft(draft.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)))} />
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-sm mt-3" onClick={saveLabels} disabled={busy}>{busy ? "저장 중…" : "이름 저장"}</button>
    </details>
  );
}
