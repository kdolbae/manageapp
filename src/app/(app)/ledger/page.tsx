import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues, labelOf } from "@/lib/codes";
import { won } from "@/lib/format";
import { LEDGER_TYPE } from "@/lib/contracts";

export const metadata = { title: "수납·환불" };

type Entry = { id: string; contract_id: string; entry_type: string; amount: number; pay_method_code: string | null; occurred_at: string; memo: string | null; voided_at: string | null; contract: { contract_no: string; customer: { name: string } | null } | null; receiver: { display_name: string } | null };

function fmt(v: string) {
  const d = new Date(v);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = typeof sp.from === "string" && sp.from ? sp.from : today.slice(0, 8) + "01";
  const to = typeof sp.to === "string" && sp.to ? sp.to : today;
  const type = typeof sp.type === "string" ? sp.type : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const supabase = await createClient();
  if (!session.can("ledger.read")) {
    return <div><div className="panel-head"><h1>수납·환불</h1></div><p className="p-4 text-sm text-muted">원장 조회 권한이 없습니다.</p></div>;
  }

  let contractIds: string[] | null = null;
  if (q) {
    const { data } = await supabase.from("contract_summary").select("id").eq("tenant_id", tid).or(`contract_no.ilike.%${q}%,customer_name.ilike.%${q}%`).limit(200);
    contractIds = (data ?? []).map((r) => r.id);
  }
  let query = supabase
    .from("ledger_entry")
    .select("id, contract_id, entry_type, amount, pay_method_code, occurred_at, memo, voided_at, contract:contract(contract_no, customer:customer(name)), receiver:profile!ledger_entry_received_by_fkey(display_name)")
    .eq("tenant_id", tid)
    .gte("occurred_at", `${from}T00:00:00+09:00`)
    .lte("occurred_at", `${to}T23:59:59+09:00`);
  if (type) query = query.eq("entry_type", type);
  if (contractIds) query = query.in("contract_id", contractIds);
  const [{ data: entries }, payMethods] = await Promise.all([
    query.order("occurred_at", { ascending: false }).limit(300),
    codeValues(tid, "pay_method"),
  ]);
  const list = (entries ?? []) as unknown as Entry[];
  const live = list.filter((e) => !e.voided_at);
  const received = live.filter((e) => LEDGER_TYPE[e.entry_type]?.side === "payment" && LEDGER_TYPE[e.entry_type]?.sign > 0).reduce((s, e) => s + Number(e.amount), 0);
  const refunded = live.filter((e) => e.entry_type === "refund").reduce((s, e) => s + Number(e.amount), 0);
  const adjusted = live.filter((e) => LEDGER_TYPE[e.entry_type]?.side === "sale").reduce((s, e) => s + LEDGER_TYPE[e.entry_type].sign * Number(e.amount), 0);
  const byMethod = payMethods.map((m) => ({ label: m.label, total: live.filter((e) => e.pay_method_code === m.code && LEDGER_TYPE[e.entry_type]?.side === "payment").reduce((s, e) => s + LEDGER_TYPE[e.entry_type].sign * Number(e.amount), 0) }));

  return (
    <div>
      <div className="panel-head">
        <h1>수납·환불 <span className="sub">{from} ~ {to}</span></h1>
        <Link href="/contracts?f=unpaid" className="btn">잔금미납 계약 보기</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 border-b border-border bg-surface">
        <div className="stat"><div className="k">수납 합계</div><div className={`v ${received ? "text-success" : "zero"}`}>{won(received)}</div></div>
        <div className="stat"><div className="k">환불</div><div className={`v ${refunded ? "text-danger" : "zero"}`}>{won(refunded)}</div></div>
        <div className="stat"><div className="k">판매 조정(할인 등)</div><div className={`v ${adjusted ? "" : "zero"}`}>{won(adjusted)}</div></div>
        {byMethod.slice(0, 2).map((m) => <div key={m.label} className="stat"><div className="k">{m.label}</div><div className={`v ${m.total ? "" : "zero"}`}>{won(m.total)}</div></div>)}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 px-3.5 py-2.5 bg-bg border-b border-border">
        <div><label className="label">시작</label><input type="date" name="from" defaultValue={from} className="field h-8 text-xs mono" /></div>
        <div><label className="label">끝</label><input type="date" name="to" defaultValue={to} className="field h-8 text-xs mono" /></div>
        <div><label className="label">유형</label><select name="type" defaultValue={type} className="field h-8 text-xs"><option value="">전체</option>{Object.entries(LEDGER_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div><label className="label">계약번호·고객</label><input name="q" defaultValue={q} className="field h-8 text-xs w-[180px]" /></div>
        <button className="btn btn-sm">조회</button>
      </form>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>일시</th><th>계약</th><th>고객</th><th>유형</th><th className="text-right">금액</th><th>결제수단</th><th>수납자</th><th>메모</th></tr></thead>
          <tbody>
            {list.map((e) => {
              const t = LEDGER_TYPE[e.entry_type] ?? { label: e.entry_type, side: "payment" as const, sign: 1 as const };
              return (
                <tr key={e.id} className={e.voided_at ? "opacity-60" : ""}>
                  <td className="mono text-xs text-muted">{fmt(e.occurred_at)}</td>
                  <td className="mono text-xs"><Link href={`/contracts/${e.contract_id}`}>{e.contract?.contract_no}</Link></td>
                  <td className="font-semibold">{e.contract?.customer?.name}</td>
                  <td><span className={`badge ${e.voided_at ? "badge-risk" : t.side === "payment" ? (t.sign > 0 ? "badge-done" : "badge-risk") : "badge-wait"}`}>{t.label}{e.voided_at ? " · 취소됨" : ""}</span></td>
                  <td className={`num ${e.voided_at ? "line-through" : ""}`}>{t.sign < 0 ? "-" : ""}{won(e.amount)}</td>
                  <td>{labelOf(payMethods, e.pay_method_code) || <span className="zero">—</span>}</td>
                  <td>{e.receiver?.display_name ?? "—"}</td>
                  <td className="text-xs text-muted">{e.memo}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={8} className="text-muted">기간 안에 기록이 없습니다.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={8}>{list.length}건 (취소 {list.length - live.length}건 포함) · 수납·취소는 계약 상세에서</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}
