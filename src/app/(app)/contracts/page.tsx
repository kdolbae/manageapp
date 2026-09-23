import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { won, shortDate } from "@/lib/format";
import { CONTRACT_STATUS, workAreaClass } from "@/lib/contracts";

export const metadata = { title: "계약 목록" };

const PAGE = 50;
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "pending", label: "승인대기" },
  { key: "wait", label: "시공대기" },
  { key: "progress", label: "시공중" },
  { key: "done", label: "시공완료" },
  { key: "unpaid", label: "잔금미납" },
  { key: "canceled", label: "취소·반려" },
];

type Row = { id: string; contract_no: string; customer_id: string; customer_name: string | null; site_name: string | null; site_unit: string | null; contract_date: string; approval_status: string; canceled_at: string | null; status: string; sale_total: number; paid_total: number; balance: number; job_count: number; done_count: number; next_date: string | null; branch_id: string | null };
type JobRow = { id: string; contract_id: string; work_area_code: string | null; status: string; scheduled_date: string | null; technician: { name: string } | null };

export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const filter = typeof sp.f === "string" ? sp.f : "all";
  const branch = typeof sp.branch === "string" ? sp.branch : "";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const supabase = await createClient();

  let query = supabase.from("contract_summary").select("*", { count: "exact" }).eq("tenant_id", tid);
  if (q) query = query.or(`contract_no.ilike.%${q}%,customer_name.ilike.%${q}%,site_name.ilike.%${q}%`);
  if (branch) query = query.eq("branch_id", branch);
  switch (filter) {
    case "pending": query = query.eq("approval_status", "pending").is("canceled_at", null); break;
    case "wait": query = query.in("status", ["undecided", "scheduled", "postponed", "no_job"]); break;
    case "progress": query = query.eq("status", "in_progress"); break;
    case "done": query = query.eq("status", "done"); break;
    case "unpaid": query = query.gt("balance", 0).eq("status", "done"); break;
    case "canceled": query = query.in("status", ["canceled", "rejected"]); break;
  }
  const from = (page - 1) * PAGE;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";

  const [{ data: rows, count }, workAreas, { data: branches }, { count: todayCount }, { data: monthRows }, { data: unpaidRows }, { count: pendingCount }, { count: todayJobs }] = await Promise.all([
    query.order("contract_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + PAGE - 1),
    codeValues(tid, "work_area"),
    supabase.from("branch").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("is_hq", { ascending: false }).order("name"),
    supabase.from("contract").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("contract_date", today).is("deleted_at", null),
    supabase.from("contract_summary").select("sale_total").eq("tenant_id", tid).gte("contract_date", monthStart).is("canceled_at", null),
    supabase.from("contract_summary").select("balance").eq("tenant_id", tid).gt("balance", 0).is("canceled_at", null).neq("approval_status", "rejected"),
    supabase.from("contract").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("approval_status", "pending").is("canceled_at", null).is("deleted_at", null),
    supabase.from("job").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("scheduled_date", today).is("deleted_at", null).neq("status", "canceled"),
  ]);
  const list = (rows ?? []) as Row[];
  const ids = list.map((r) => r.id);
  const { data: jobs } = ids.length
    ? await supabase.from("job").select("id, contract_id, work_area_code, status, scheduled_date, technician:technician(name)").in("contract_id", ids).is("deleted_at", null).neq("status", "canceled").order("scheduled_date")
    : { data: [] as JobRow[] };
  const jobList = (jobs ?? []) as unknown as JobRow[];
  const monthTotal = (monthRows ?? []).reduce((s, r) => s + Number(r.sale_total), 0);
  const unpaidTotal = (unpaidRows ?? []).reduce((s, r) => s + Number(r.balance), 0);
  const shownBalance = list.reduce((s, r) => s + Number(r.balance), 0);
  const total = count ?? 0;
  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ q, f: filter, branch, ...patch });
    for (const [k, v] of Array.from(p.entries())) if (!v || (k === "f" && v === "all")) p.delete(k);
    const s = p.toString();
    return `/contracts${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <div className="panel-head">
        <h1>계약 목록 <span className="sub">{total.toLocaleString("ko-KR")}건</span></h1>
        {session.can("contract.write") && <Link href="/contracts/new" className="btn btn-primary">계약 등록</Link>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 border-b border-border bg-surface">
        <div className="stat"><div className="k">오늘 계약</div><div className={`v ${todayCount ? "" : "zero"}`}>{todayCount ?? 0}건</div></div>
        <div className="stat"><div className="k">금월 계약금액</div><div className={`v ${monthTotal ? "" : "zero"}`}>{won(monthTotal)}</div></div>
        <div className="stat"><div className="k">미수 잔액</div><div className={`v ${unpaidTotal ? "text-danger" : "zero"}`}>{won(unpaidTotal)}</div></div>
        <div className="stat"><div className="k">계약 승인대기</div><div className={`v ${pendingCount ? "text-warn" : "zero"}`}>{pendingCount ?? 0}건</div></div>
        <div className="stat"><div className="k">오늘 시공</div><div className={`v ${todayJobs ? "" : "zero"}`}>{todayJobs ?? 0}건</div></div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        {FILTERS.map((f) => (
          <Link key={f.key} href={link({ f: f.key, page: "" })} className={`chip ${filter === f.key ? "is-active" : ""}`}>{f.label}</Link>
        ))}
        <form method="get" className="ml-auto flex gap-1.5 items-center">
          <input type="hidden" name="f" value={filter} />
          {(branches ?? []).length > 1 && (
            <select name="branch" defaultValue={branch} className="field h-8 text-xs w-[120px]">
              <option value="">모든 지점</option>
              {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <input name="q" defaultValue={q} placeholder="계약번호·고객·현장" className="field h-8 text-xs w-[180px]" />
          <button className="btn btn-sm">찾기</button>
        </form>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>계약번호</th>
              <th>고객 · 현장</th>
              <th>계약일</th>
              {workAreas.map((w, i) => <th key={w.code} className={`text-${workAreaClass(w.color, i)}`}>{w.label} 기사·예정</th>)}
              <th className="text-right">계약금액</th>
              <th className="text-right">입금</th>
              <th className="text-right">잔액</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const st = CONTRACT_STATUS[r.status] ?? { label: r.status, badge: "wait" as const };
              const risk = r.status === "done" && r.balance > 0;
              return (
                <tr key={r.id}>
                  <td className="mono text-xs whitespace-nowrap"><Link href={`/contracts/${r.id}`}>{r.contract_no}</Link></td>
                  <td><Link href={`/contracts/${r.id}`} className="font-semibold text-text no-underline">{r.customer_name}</Link><div className="text-xs text-muted">{[r.site_name, r.site_unit].filter(Boolean).join(" ")}</div></td>
                  <td className="mono text-xs text-muted">{shortDate(r.contract_date)}</td>
                  {workAreas.map((w, i) => {
                    const js = jobList.filter((j) => j.contract_id === r.id && j.work_area_code === w.code);
                    return (
                      <td key={w.code} className="text-xs">
                        {js.length === 0 ? <span className="zero">—</span> : js.map((j) => (
                          <div key={j.id} className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className={`mark mark-${workAreaClass(w.color, i)}`}>{w.label.slice(0, 1)}</span>
                            <span>{j.technician?.name ?? <span className="text-muted">미배정</span>}</span>
                            <span className="mono text-muted">{j.scheduled_date ? shortDate(j.scheduled_date) : "미정"}</span>
                          </div>
                        ))}
                      </td>
                    );
                  })}
                  <td className="num">{won(r.sale_total)}</td>
                  <td className={`num ${Number(r.paid_total) ? "text-muted" : "zero"}`}>{won(r.paid_total)}</td>
                  <td className={`num font-semibold ${Number(r.balance) ? (risk ? "text-danger" : "") : "zero"}`}>{won(r.balance)}</td>
                  <td><span className={`badge badge-${risk ? "risk" : st.badge}`}>{risk ? "잔금미납" : st.label}</span></td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={7 + workAreas.length} className="text-muted">계약이 없습니다.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3 + workAreas.length}>
                {total ? `${from + 1}–${Math.min(from + PAGE, total)} / ${total.toLocaleString("ko-KR")}` : "0"}
                {page > 1 && <Link href={link({ page: String(page - 1) })} className="ml-3">이전</Link>}
                {from + PAGE < total && <Link href={link({ page: String(page + 1) })} className="ml-3">다음</Link>}
              </td>
              <td colSpan={4} className="text-right">표시 행 잔액 합계 {won(shownBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
