import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won, phone } from "@/lib/format";
import { todayKST, addDays, mmdd, weekday } from "@/lib/dates";
import { monthStart, sum, groupBy } from "@/lib/stats";
import { JOB_STATUS, TIME_SLOT, workAreaClass } from "@/lib/contracts";
import { codeValues } from "@/lib/codes";
import { INQUIRY_STATUS, INQUIRY_CHANNEL, fmtDateTime, minutesSince } from "@/lib/inbox";

export const metadata = { title: "모니터링" };

type Job = { id: string; contract_id: string; work_area_code: string | null; status: string; scheduled_date: string | null; time_slot: string; technician_id: string | null; technician_name: string | null; contract_no: string; customer_name: string | null; site_name: string | null; site_unit: string | null; balance: number };
type Contract = { id: string; contract_no: string; customer_name: string | null; branch_id: string | null; contract_date: string; approval_status: string; canceled_at: string | null; status: string; sale_total: number; paid_total: number; balance: number; created_at: string };
type Inquiry = { id: string; name: string | null; phone: string | null; kind: string | null; channel: string; status: string; created_at: string };

export default async function HomePage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const today = todayKST();
  const weekEnd = addDays(today, 6);
  const mStart = monthStart(today);
  const canJobs = session.can("job.read");
  const canContracts = session.can("contract.read");
  const canLedger = session.can("ledger.read");
  const canInquiry = session.can("inquiry.read");

  const [{ data: weekJobs }, { data: monthContracts }, { data: unpaid }, { data: inquiries }, workAreas, { data: branches }, { count: pendingApproval }] = await Promise.all([
    canJobs
      ? supabase.from("job_summary").select("id, contract_id, work_area_code, status, scheduled_date, time_slot, technician_id, technician_name, contract_no, customer_name, site_name, site_unit, balance").eq("tenant_id", tid).is("deleted_at", null).neq("status", "canceled").gte("scheduled_date", today).lte("scheduled_date", weekEnd).order("scheduled_date").order("time_slot")
      : Promise.resolve({ data: [] as Job[] }),
    canContracts
      ? supabase.from("contract_summary").select("id, contract_no, customer_name, branch_id, contract_date, approval_status, canceled_at, status, sale_total, paid_total, balance, created_at").eq("tenant_id", tid).gte("contract_date", mStart).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Contract[] }),
    canContracts && canLedger
      ? supabase.from("contract_summary").select("id, contract_no, customer_name, branch_id, contract_date, approval_status, canceled_at, status, sale_total, paid_total, balance, created_at").eq("tenant_id", tid).gt("balance", 0).is("canceled_at", null).neq("approval_status", "rejected").order("contract_date")
      : Promise.resolve({ data: [] as Contract[] }),
    canInquiry
      ? supabase.from("inquiry").select("id, name, phone, kind, channel, status, created_at").eq("tenant_id", tid).is("deleted_at", null).in("status", ["new", "contacted", "quoted"]).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as Inquiry[] }),
    codeValues(tid, "work_area"),
    supabase.from("branch").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null),
    canContracts && session.can("contract.approve")
      ? supabase.from("contract").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("approval_status", "pending").is("canceled_at", null).is("deleted_at", null)
      : Promise.resolve({ count: null }),
  ]);

  const jobs = (weekJobs ?? []) as Job[];
  const todayJobs = jobs.filter((j) => j.scheduled_date === today);
  const contracts = (monthContracts ?? []) as Contract[];
  const monthActive = contracts.filter((c) => !c.canceled_at && c.approval_status !== "rejected");
  const unpaidRows = (unpaid ?? []) as Contract[];
  const inq = (inquiries ?? []) as Inquiry[];
  const newInq = inq.filter((i) => i.status === "new");
  const lateInq = newInq.filter((i) => minutesSince(i.created_at) > 60);
  const unassigned = jobs.filter((j) => !j.technician_id && j.scheduled_date && j.scheduled_date <= addDays(today, 3));
  const unpaidDone = unpaidRows.filter((c) => c.status === "done");
  const waIndex = new Map(workAreas.map((w, i) => [w.code, i]));
  const waColor = new Map(workAreas.map((w) => [w.code, w.color]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const byDay = groupBy(jobs, (j) => j.scheduled_date);
  const byTech = groupBy(todayJobs, (j) => j.technician_name ?? "미배정");
  const dateLabel = `${mmdd(today)} (${weekday(today)})`;

  const attention: { text: string; href: string; tone: "risk" | "wait" }[] = [];
  if (lateInq.length) attention.push({ text: `1시간 넘게 응답 없는 문의 ${lateInq.length}건`, href: "/inbox?status=new", tone: "risk" });
  else if (newInq.length) attention.push({ text: `새 문의 ${newInq.length}건`, href: "/inbox?status=new", tone: "wait" });
  if (unassigned.length) attention.push({ text: `3일 안 시공인데 기사 미배정 ${unassigned.length}건`, href: "/assign", tone: "risk" });
  if (pendingApproval) attention.push({ text: `승인 기다리는 계약 ${pendingApproval}건`, href: "/contracts?f=pending", tone: "wait" });
  if (unpaidDone.length) attention.push({ text: `시공 끝났는데 잔금 남은 계약 ${unpaidDone.length}건 · ${won(sum(unpaidDone, (c) => c.balance))}원`, href: "/contracts?f=unpaid", tone: "wait" });
  const todayNotStarted = todayJobs.filter((j) => j.status === "assigned" || j.status === "scheduled");
  if (todayNotStarted.length && todayJobs.length && todayNotStarted.length < todayJobs.length) attention.push({ text: `오늘 시공 중 아직 시작 전 ${todayNotStarted.length}건`, href: "/jobs", tone: "wait" });

  return (
    <div>
      <div className="panel-head">
        <h1>모니터링 <span className="sub">{dateLabel} · {session.current.tenant.name}</span></h1>
        {session.can("contract.write") && <Link href="/contracts/new" className="btn btn-primary">계약 등록</Link>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border-b border-border bg-surface">
        <Link href="/jobs" className="stat no-underline text-text"><div className="k">오늘 시공</div><div className={`v ${todayJobs.length ? "" : "zero"}`}>{todayJobs.length}<span className="text-xs text-muted font-normal ml-1">완료 {todayJobs.filter((j) => j.status === "done").length}</span></div></Link>
        <Link href="/contracts" className="stat no-underline text-text"><div className="k">이번 달 계약</div><div className={`v ${monthActive.length ? "" : "zero"}`}>{monthActive.length}<span className="text-xs text-muted font-normal ml-1">건</span></div></Link>
        <div className="stat"><div className="k">이번 달 매출</div><div className={`v ${monthActive.length ? "" : "zero"}`}>{won(sum(monthActive, (c) => c.sale_total))}<span className="text-xs text-muted font-normal ml-1">원</span></div></div>
        <Link href="/contracts?f=unpaid" className="stat no-underline text-text"><div className="k">미수 잔액</div><div className={`v ${unpaidRows.length ? "" : "zero"}`}>{canLedger ? won(sum(unpaidRows, (c) => c.balance)) : "—"}<span className="text-xs text-muted font-normal ml-1">{canLedger ? `원 · ${unpaidRows.length}건` : "권한 없음"}</span></div></Link>
        <Link href="/inbox?status=new" className="stat no-underline text-text"><div className="k">새 문의</div><div className={`v ${newInq.length ? (lateInq.length ? "text-danger" : "") : "zero"}`}>{canInquiry ? newInq.length : "—"}{lateInq.length > 0 && <span className="text-xs font-normal ml-1">지연 {lateInq.length}</span>}</div></Link>
        <Link href="/assign" className="stat no-underline text-text"><div className="k">이번 주 시공</div><div className={`v ${jobs.length ? "" : "zero"}`}>{jobs.length}<span className="text-xs text-muted font-normal ml-1">미배정 {jobs.filter((j) => !j.technician_id).length}</span></div></Link>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_360px] items-start">
        <div className="grid gap-4">
          {attention.length > 0 && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-2">지금 볼 것</h2>
              <ul className="grid gap-1.5 text-sm">
                {attention.map((a) => <li key={a.href + a.text} className="flex items-center gap-2"><span className={`badge badge-${a.tone}`}>{a.tone === "risk" ? "지연" : "확인"}</span><Link href={a.href}>{a.text}</Link></li>)}
              </ul>
            </div>
          )}
          {canJobs && (
            <div className="card">
              <div className="panel-head"><h2>오늘 시공 <span className="sub">{todayJobs.length}건</span></h2><Link href="/assign" className="btn btn-sm">배정 보드</Link></div>
              {todayJobs.length === 0 ? <p className="p-4 text-sm text-muted">오늘 잡힌 시공이 없습니다.</p> : (
                <table className="tbl">
                  <thead><tr><th>기사</th><th>시간</th><th>계약 · 고객</th><th>작업</th><th>상태</th><th className="text-right">잔금</th></tr></thead>
                  <tbody>
                    {[...byTech.entries()].map(([tech, list]) => list.map((j, i) => {
                      const st = JOB_STATUS[j.status] ?? { label: j.status, badge: "wait" as const };
                      return (
                        <tr key={j.id}>
                          {i === 0 && <td rowSpan={list.length} className="font-semibold align-top">{tech}</td>}
                          <td className="text-xs">{TIME_SLOT[j.time_slot] ?? j.time_slot}</td>
                          <td><Link href={`/contracts/${j.contract_id}`} className="mono text-xs">{j.contract_no}</Link> <span className="font-medium">{j.customer_name}</span><div className="text-xs text-muted">{[j.site_name, j.site_unit].filter(Boolean).join(" ")}</div></td>
                          <td>{j.work_area_code ? <span className={`mark ${workAreaClass(waColor.get(j.work_area_code), waIndex.get(j.work_area_code) ?? 0)}`}>{workAreas.find((w) => w.code === j.work_area_code)?.label ?? j.work_area_code}</span> : "—"}</td>
                          <td><span className={`badge badge-${st.badge}`}>{st.label}</span></td>
                          <td className="num text-right">{canLedger ? (j.balance > 0 ? `${won(j.balance)}원` : <span className="zero">0</span>) : "—"}</td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {canJobs && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-2">이번 주 시공 흐름</h2>
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
                  const list = byDay.get(d) ?? [];
                  const max = Math.max(1, ...[...byDay.values()].map((l) => l.length));
                  const un = list.filter((j) => !j.technician_id).length;
                  return (
                    <Link key={d} href={`/jobs?from=${d}`} className="no-underline text-text text-center">
                      <div className="h-16 flex items-end justify-center gap-0.5">
                        <div className="w-4 rounded-t-sm bg-accent" style={{ height: `${Math.round(((list.length - un) / max) * 100)}%` }} title={`배정 ${list.length - un}`} />
                        {un > 0 && <div className="w-4 rounded-t-sm bg-warn" style={{ height: `${Math.round((un / max) * 100)}%` }} title={`미배정 ${un}`} />}
                      </div>
                      <div className={`text-[11px] mt-1 ${d === today ? "font-bold" : "text-muted"}`}>{mmdd(d)} {weekday(d)}</div>
                      <div className="num text-xs">{list.length}{un > 0 && <span className="text-warn">/{un}</span>}</div>
                    </Link>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted mt-2">막대 = 배정된 시공, 주황 = 기사 미배정. 숫자는 건수/미배정.</p>
            </div>
          )}
          {canContracts && (
            <div className="card">
              <div className="panel-head"><h2>이번 달 계약 <span className="sub">{mmdd(mStart)}부터 · {monthActive.length}건 · {won(sum(monthActive, (c) => c.sale_total))}원</span></h2><Link href="/sales" className="btn btn-sm">영업 분석</Link></div>
              <table className="tbl">
                <thead><tr><th>계약일</th><th>번호</th><th>고객</th>{(branches ?? []).length > 1 && <th>지점</th>}<th className="text-right">금액</th><th className="text-right">잔액</th><th>상태</th></tr></thead>
                <tbody>
                  {contracts.slice(0, 8).map((c) => (
                    <tr key={c.id}>
                      <td className="mono text-xs">{mmdd(c.contract_date)}</td>
                      <td><Link href={`/contracts/${c.id}`} className="mono text-xs">{c.contract_no}</Link></td>
                      <td className="font-medium">{c.customer_name}</td>
                      {(branches ?? []).length > 1 && <td className="text-xs">{c.branch_id ? branchName.get(c.branch_id) ?? "" : "본사"}</td>}
                      <td className="num text-right">{won(c.sale_total)}</td>
                      <td className="num text-right">{canLedger ? (c.balance > 0 ? won(c.balance) : <span className="zero">0</span>) : "—"}</td>
                      <td className="text-xs">{c.canceled_at ? "취소" : c.approval_status === "pending" ? "승인 대기" : c.approval_status === "rejected" ? "반려" : c.status === "done" ? "완료" : c.status === "in_progress" ? "진행" : "예정"}</td>
                    </tr>
                  ))}
                  {contracts.length === 0 && <tr><td colSpan={7} className="text-muted">이번 달 계약이 아직 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid gap-4">
          {canInquiry && (
            <div className="card">
              <div className="panel-head"><h2>처리 중 문의 <span className="sub">{inq.length}건</span></h2><Link href="/inbox" className="btn btn-sm">인입함</Link></div>
              <ul className="divide-y divide-border">
                {inq.slice(0, 8).map((i) => {
                  const st = INQUIRY_STATUS[i.status] ?? { label: i.status, badge: "wait" as const };
                  return (
                    <li key={i.id} className="px-4 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2"><Link href={`/inbox/${i.id}`} className="font-medium text-text no-underline truncate">{i.name ?? "이름 없음"}</Link><span className={`badge badge-${st.badge}`}>{st.label}</span></div>
                      <div className="text-xs text-muted flex gap-2"><span>{INQUIRY_CHANNEL[i.channel] ?? i.channel}</span>{i.kind && <span>{i.kind}</span>}<span className="mono">{phone(i.phone)}</span><span className="ml-auto mono">{fmtDateTime(i.created_at)}</span></div>
                    </li>
                  );
                })}
                {inq.length === 0 && <li className="px-4 py-3 text-sm text-muted">처리 중인 문의가 없습니다.</li>}
              </ul>
            </div>
          )}
          {(branches ?? []).length > 1 && canContracts && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold mb-2">지점별 이번 달</h2>
              <table className="tbl">
                <thead><tr><th>지점</th><th className="text-right">계약</th><th className="text-right">매출</th></tr></thead>
                <tbody>
                  {[...groupBy(monthActive, (c) => c.branch_id ?? "hq").entries()].sort((a, b) => sum(b[1], (c) => c.sale_total) - sum(a[1], (c) => c.sale_total)).map(([bid, list]) => (
                    <tr key={bid}><td>{bid === "hq" ? "본사" : branchName.get(bid) ?? "—"}</td><td className="num text-right">{list.length}</td><td className="num text-right">{won(sum(list, (c) => c.sale_total))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-2">바로 가기</h2>
            <div className="flex flex-wrap gap-1.5">
              {session.can("job.read") && <Link href="/jobs/today" className="btn btn-sm">오늘 시공(기사용)</Link>}
              {session.can("job.assign") && <Link href="/assign" className="btn btn-sm">배정 보드</Link>}
              {session.can("ledger.read") && <Link href="/ledger" className="btn btn-sm">수납·환불</Link>}
              {session.can("customer.read") && <Link href="/people/customers" className="btn btn-sm">고객</Link>}
              {session.can("content.read") && <Link href="/content" className="btn btn-sm">사진·후기</Link>}
              {session.can("tenant.manage") && <Link href="/settings/integrations" className="btn btn-sm">홈페이지·Teams 연동</Link>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
