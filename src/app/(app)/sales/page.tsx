import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { todayKST, addDays, isValidYmd, mmdd } from "@/lib/dates";
import { monthStart, monthEnd, prevPeriod, deltaText, sum, groupBy, pctText, weekKey } from "@/lib/stats";
import { codeValues, labelOf } from "@/lib/codes";
import { INQUIRY_CHANNEL } from "@/lib/inbox";
import { Bars } from "@/components/bars";
import { memberOptions } from "@/app/(app)/people/data";

export const metadata = { title: "영업 분석" };

type Contract = { id: string; contract_no: string; customer_name: string | null; branch_id: string | null; partner_id: string | null; sales_owner_id: string | null; contract_date: string; approval_status: string; canceled_at: string | null; status: string; sale_total: number; paid_total: number; balance: number; source_code: string | null; intake_type_code: string | null };
type Line = { contract_id: string; name: string; work_area_code: string | null; qty: number; amount: number; contract: { contract_date: string; canceled_at: string | null; approval_status: string; branch_id: string | null } | null };
type Inquiry = { id: string; channel: string; status: string; utm: Record<string, string>; created_at: string; contract_id: string | null };

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  if (!session.can("report.read")) {
    return <p className="p-4 text-sm text-muted">보고서 권한이 없습니다.</p>;
  }
  const sp = await searchParams;
  const today = todayKST();
  const from = isValidYmd(sp.from) ? sp.from : monthStart(today);
  const to = isValidYmd(sp.to) ? sp.to : today;
  const branch = typeof sp.branch === "string" ? sp.branch : "";
  const prev = prevPeriod(from, to);
  const supabase = await createClient();
  const canLedger = session.can("ledger.read");

  const SELECT = "id, contract_no, customer_name, branch_id, partner_id, sales_owner_id, contract_date, approval_status, canceled_at, status, sale_total, paid_total, balance, source_code, intake_type_code";
  let cq = supabase.from("contract_summary").select(SELECT).eq("tenant_id", tid).gte("contract_date", from).lte("contract_date", to).order("contract_date");
  let pq = supabase.from("contract_summary").select("id, canceled_at, approval_status, sale_total, paid_total").eq("tenant_id", tid).gte("contract_date", prev.from).lte("contract_date", prev.to);
  let lq = supabase.from("contract_line").select("contract_id, name, work_area_code, qty, amount, contract!inner(contract_date, canceled_at, approval_status, branch_id)").eq("tenant_id", tid).gte("contract.contract_date", from).lte("contract.contract_date", to);
  let iq = supabase.from("inquiry").select("id, channel, status, utm, created_at, contract_id").eq("tenant_id", tid).is("deleted_at", null).gte("created_at", `${from}T00:00:00+09:00`).lte("created_at", `${to}T23:59:59+09:00`);
  if (branch) {
    cq = cq.eq("branch_id", branch);
    pq = pq.eq("branch_id", branch);
    lq = lq.eq("contract.branch_id", branch);
    iq = iq.eq("branch_id", branch);
  }
  const [{ data: cRows }, { data: pRows }, { data: lRows }, { data: iRows }, sources, intakes, workAreas, { data: branches }, members, { data: partners }] = await Promise.all([
    cq, pq, lq,
    session.can("inquiry.read") ? iq : Promise.resolve({ data: [] as Inquiry[] }),
    codeValues(tid, "customer_source"), codeValues(tid, "intake_type"), codeValues(tid, "work_area"),
    supabase.from("branch").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("is_hq", { ascending: false }).order("name"),
    memberOptions(supabase, tid),
    session.can("partner.read") ? supabase.from("partner").select("id, name").eq("tenant_id", tid) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const all = (cRows ?? []) as Contract[];
  const live = all.filter((c) => !c.canceled_at && c.approval_status !== "rejected");
  const lost = all.length - live.length;
  const prevAll = (pRows ?? []) as { canceled_at: string | null; approval_status: string; sale_total: number; paid_total: number }[];
  const prevLive = prevAll.filter((c) => !c.canceled_at && c.approval_status !== "rejected");
  const lines = ((lRows ?? []) as unknown as Line[]).filter((l) => l.contract && !l.contract.canceled_at && l.contract.approval_status !== "rejected");
  const inquiries = (iRows ?? []) as Inquiry[];
  const converted = inquiries.filter((i) => i.status === "converted" || i.contract_id).length;
  const sales = sum(live, (c) => c.sale_total);
  const paid = sum(live, (c) => c.paid_total);
  const prevSales = sum(prevLive, (c) => c.sale_total);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const partnerName = new Map(((partners ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const waLabel = (code: string | null) => (code ? labelOf(workAreas, code) || code : "공통");

  const periods = [
    { label: "이번 달", from: monthStart(today), to: today },
    { label: "지난 달", from: monthStart(addDays(monthStart(today), -1)), to: monthEnd(addDays(monthStart(today), -1)) },
    { label: "최근 90일", from: addDays(today, -89), to: today },
    { label: "올해", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  const qs = (f: string, t: string, b = branch) => `/sales?from=${f}&to=${t}${b ? `&branch=${b}` : ""}`;
  const bars = <T,>(map: Map<string, T[]>, label: (k: string) => React.ReactNode, value: (list: T[]) => number, sub?: (list: T[]) => React.ReactNode) =>
    [...map.entries()].map(([k, list]) => ({ key: k || "-", label: label(k), value: value(list), sub: sub?.(list) })).sort((a, b) => b.value - a.value).slice(0, 12);
  const weeks = groupBy(live, (c) => weekKey(c.contract_date));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        <span className="text-xs text-muted mr-1">{mmdd(from)} ~ {mmdd(to)}{branch ? ` · ${branchName.get(branch) ?? ""}` : ""}</span>
        {periods.map((p) => <Link key={p.label} href={qs(p.from, p.to)} className={`chip ${from === p.from && to === p.to ? "is-active" : ""}`}>{p.label}</Link>)}
        <form method="get" className="flex items-center gap-1.5 ml-auto">
          <input type="date" name="from" defaultValue={from} className="field h-8 text-xs w-[140px]" />
          <span className="text-xs text-muted">~</span>
          <input type="date" name="to" defaultValue={to} className="field h-8 text-xs w-[140px]" />
          {(branches ?? []).length > 1 && <select name="branch" defaultValue={branch} className="field h-8 text-xs"><option value="">전 지점</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          <button className="btn btn-sm">보기</button>
        </form>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border-b border-border bg-surface">
        <div className="stat"><div className="k">계약</div><div className={`v ${live.length ? "" : "zero"}`}>{live.length}<span className="text-xs text-muted font-normal ml-1">건 · 직전 {deltaText(live.length, prevLive.length)}</span></div></div>
        <div className="stat"><div className="k">매출</div><div className={`v ${sales ? "" : "zero"}`}>{won(sales)}<span className="text-xs text-muted font-normal ml-1">원 · 직전 {deltaText(sales, prevSales)}</span></div></div>
        <div className="stat"><div className="k">평균 계약금액</div><div className={`v ${live.length ? "" : "zero"}`}>{won(live.length ? sales / live.length : 0)}<span className="text-xs text-muted font-normal ml-1">원</span></div></div>
        <div className="stat"><div className="k">수납률</div><div className={`v ${sales ? "" : "zero"}`}>{canLedger ? pctText(paid, sales) : "—"}<span className="text-xs text-muted font-normal ml-1">{canLedger ? `잔액 ${won(sales - paid)}원` : "권한 없음"}</span></div></div>
        <div className="stat"><div className="k">취소·반려</div><div className={`v ${lost ? "text-danger" : "zero"}`}>{lost}<span className="text-xs text-muted font-normal ml-1">건 · {pctText(lost, all.length)}</span></div></div>
        <div className="stat"><div className="k">문의→계약</div><div className={`v ${inquiries.length ? "" : "zero"}`}>{pctText(converted, inquiries.length)}<span className="text-xs text-muted font-normal ml-1">문의 {inquiries.length} · 전환 {converted}</span></div></div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2 items-start">
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">주별 추이</h2>
          <p className="text-xs text-muted mb-3">계약일 기준, 월요일 시작 주.</p>
          <Bars unit="won" rows={[...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([w, list]) => ({ key: w, label: `${mmdd(w)} 주`, value: sum(list, (c) => c.sale_total), sub: `${list.length}건` }))} />
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">유입 경로별 계약</h2>
          <p className="text-xs text-muted mb-3">고객 등록 시 남긴 유입 경로(source) 기준. 문의에서 전환된 고객은 문의 채널이 따라옵니다.</p>
          <Bars unit="won" rows={bars(groupBy(live, (c) => c.source_code), (k) => (k ? labelOf(sources, k) || k : "미기록"), (l) => sum(l, (c) => c.sale_total), (l) => `${l.length}건`)} />
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">상품별</h2>
          <p className="text-xs text-muted mb-3">계약 품목 금액 기준(할인 반영).</p>
          <Bars unit="won" rows={bars(groupBy(lines, (l) => l.name), (k) => k, (l) => sum(l, (x) => x.amount), (l) => `${sum(l, (x) => x.qty)}개`)} />
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">작업 단위별</h2>
          <p className="text-xs text-muted mb-3">주방·욕실 등 사업체가 정한 작업 단위.</p>
          <Bars unit="won" rows={bars(groupBy(lines, (l) => l.work_area_code), (k) => waLabel(k || null), (l) => sum(l, (x) => x.amount), (l) => `${l.length}품목`)} />
        </div>
        {session.can("inquiry.read") && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-1">문의 채널 전환율</h2>
            <p className="text-xs text-muted mb-3">기간 안에 들어온 문의가 계약으로 이어진 비율.</p>
            <table className="tbl">
              <thead><tr><th>채널</th><th className="text-right">문의</th><th className="text-right">전환</th><th className="text-right">전환율</th></tr></thead>
              <tbody>
                {[...groupBy(inquiries, (i) => i.channel).entries()].sort((a, b) => b[1].length - a[1].length).map(([ch, list]) => {
                  const cv = list.filter((i) => i.status === "converted" || i.contract_id).length;
                  return <tr key={ch}><td>{INQUIRY_CHANNEL[ch] ?? ch}</td><td className="num text-right">{list.length}</td><td className="num text-right">{cv}</td><td className="num text-right">{pctText(cv, list.length)}</td></tr>;
                })}
                {inquiries.length === 0 && <tr><td colSpan={4} className="text-muted">기간 안에 문의가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {session.can("inquiry.read") && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-1">광고·검색 유입 (UTM)</h2>
            <p className="text-xs text-muted mb-3">홈페이지 문의에 실려 온 utm_source / utm_campaign. 광고 링크에 UTM 을 붙일수록 정확해집니다.</p>
            <Bars rows={bars(groupBy(inquiries.filter((i) => i.utm?.utm_source), (i) => `${i.utm.utm_source}${i.utm.utm_campaign ? ` · ${i.utm.utm_campaign}` : ""}`), (k) => k, (l) => l.length, (l) => `전환 ${l.filter((i) => i.status === "converted" || i.contract_id).length}`)} empty="UTM 이 실린 문의가 아직 없습니다." />
          </div>
        )}
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">접수 유형별</h2>
          <p className="text-xs text-muted mb-3">계약 등록 때 고른 접수 유형(intake).</p>
          <Bars unit="won" rows={bars(groupBy(live, (c) => c.intake_type_code), (k) => (k ? labelOf(intakes, k) || k : "미기록"), (l) => sum(l, (c) => c.sale_total), (l) => `${l.length}건`)} />
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">영업 담당별</h2>
          <Bars unit="won" rows={bars(groupBy(live, (c) => c.sales_owner_id), (k) => (k ? nameOf.get(k) ?? "(구성원 아님)" : "담당 없음"), (l) => sum(l, (c) => c.sale_total), (l) => `${l.length}건`)} />
        </div>
        {(branches ?? []).length > 1 && !branch && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-1">지점별</h2>
            <Bars unit="won" rows={bars(groupBy(live, (c) => c.branch_id), (k) => (k ? <Link href={qs(from, to, k)}>{branchName.get(k) ?? "—"}</Link> : "본사"), (l) => sum(l, (c) => c.sale_total), (l) => `${l.length}건`)} />
          </div>
        )}
        {live.some((c) => c.partner_id) && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-1">협력업체(발주처)별</h2>
            <Bars unit="won" rows={bars(groupBy(live.filter((c) => c.partner_id), (c) => c.partner_id), (k) => partnerName.get(k) ?? "(조회 불가)", (l) => sum(l, (c) => c.sale_total), (l) => `${l.length}건`)} />
          </div>
        )}
      </div>
    </div>
  );
}
