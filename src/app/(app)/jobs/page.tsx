import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { won } from "@/lib/format";
import { todayKST, addDays, weekday, mmdd, isValidYmd } from "@/lib/dates";
import { JOB_STATUS, JOB_KIND, TIME_SLOT, workAreaClass } from "@/lib/contracts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { quickAssign } from "@/lib/actions/jobs";

export const metadata = { title: "시공 일정" };

type Job = { id: string; contract_id: string; contract_no: string; work_area_code: string | null; kind: string; status: string; scheduled_date: string | null; time_slot: string; technician_id: string | null; technician_name: string | null; customer_name: string | null; site_name: string | null; site_unit: string | null; balance: number; memo: string | null; branch_id: string | null };

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const today = todayKST();
  const from = isValidYmd(sp.from) ? sp.from : today;
  const to = isValidYmd(sp.to) ? sp.to : addDays(from, 6);
  const status = typeof sp.status === "string" ? sp.status : "";
  const tech = typeof sp.tech === "string" ? sp.tech : "";
  const wa = typeof sp.wa === "string" ? sp.wa : "";
  const supabase = await createClient();

  let query = supabase.from("job_summary").select("*").eq("tenant_id", tid).neq("status", "canceled");
  if (status === "undated") query = query.is("scheduled_date", null);
  else {
    query = query.gte("scheduled_date", from).lte("scheduled_date", to);
    if (status) query = query.eq("status", status);
  }
  if (tech === "none") query = query.is("technician_id", null);
  else if (tech) query = query.eq("technician_id", tech);
  if (wa) query = query.eq("work_area_code", wa);

  const [{ data: jobs }, workAreas, { data: technicians }, { count: undated }] = await Promise.all([
    query.order("scheduled_date", { ascending: true, nullsFirst: false }).order("time_slot").limit(500),
    codeValues(tid, "work_area"),
    supabase.from("technician").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("name"),
    supabase.from("job").select("id", { count: "exact", head: true }).eq("tenant_id", tid).is("scheduled_date", null).is("deleted_at", null).not("status", "in", "(done,canceled)"),
  ]);
  const list = (jobs ?? []) as Job[];
  const techList = (technicians ?? []) as { id: string; name: string }[];
  const canAssign = session.can("job.assign") || session.can("job.write");
  const unassigned = list.filter((j) => !j.technician_id && j.status !== "done").length;
  const done = list.filter((j) => j.status === "done").length;
  const waMark = (code: string | null) => {
    const i = workAreas.findIndex((w) => w.code === code);
    if (i < 0) return <span className="text-muted">전체</span>;
    const w = workAreas[i];
    return <span className="inline-flex items-center gap-1.5"><span className={`mark mark-${workAreaClass(w.color, i)}`}>{w.label.slice(0, 1)}</span>{w.label}</span>;
  };

  return (
    <div>
      <div className="panel-head">
        <h1>시공 일정 <span className="sub">{mmdd(from)} ~ {mmdd(to)}</span></h1>
        {canAssign && <Link href={`/assign?start=${from}`} className="btn btn-primary">배정 보드</Link>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 border-b border-border bg-surface">
        <div className="stat"><div className="k">기간 내 시공</div><div className="v">{list.length}건</div></div>
        <div className="stat"><div className="k">미배정</div><div className={`v ${unassigned ? "text-warn" : "zero"}`}>{unassigned}건</div></div>
        <div className="stat"><div className="k">날짜 미정 (전체)</div><div className={`v ${undated ? "text-warn" : "zero"}`}>{undated ?? 0}건</div></div>
        <div className="stat"><div className="k">완료</div><div className={`v ${done ? "text-success" : "zero"}`}>{done}건</div></div>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 px-3.5 py-2.5 bg-bg border-b border-border">
        <div><label className="label">시작</label><input type="date" name="from" defaultValue={from} className="field h-8 text-xs mono" /></div>
        <div><label className="label">끝</label><input type="date" name="to" defaultValue={to} className="field h-8 text-xs mono" /></div>
        <div><label className="label">상태</label><select name="status" defaultValue={status} className="field h-8 text-xs"><option value="">전체</option>{Object.entries(JOB_STATUS).filter(([k]) => k !== "canceled").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}<option value="undated">날짜 미정</option></select></div>
        <div><label className="label">담당</label><select name="tech" defaultValue={tech} className="field h-8 text-xs"><option value="">전체</option><option value="none">미배정</option>{techList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label className="label">작업 단위</label><select name="wa" defaultValue={wa} className="field h-8 text-xs"><option value="">전체</option>{workAreas.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}</select></div>
        <button className="btn btn-sm">조회</button>
        <Link href={`/jobs?from=${addDays(from, -7)}&to=${addDays(from, -1)}`} className="btn btn-sm">지난주</Link>
        <Link href={`/jobs?from=${addDays(to, 1)}&to=${addDays(to, 7)}`} className="btn btn-sm">다음주</Link>
      </form>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>날짜</th><th>작업 단위</th><th>고객 · 현장</th><th>계약</th><th>담당</th><th>상태</th><th className="text-right">잔액</th><th>메모</th>{canAssign && <th></th>}</tr></thead>
          <tbody>
            {list.map((j) => {
              const js = JOB_STATUS[j.status] ?? { label: j.status, badge: "wait" as const };
              return (
                <tr key={j.id}>
                  <td className="mono text-xs whitespace-nowrap">{j.scheduled_date ? <>{mmdd(j.scheduled_date)} <span className="text-muted">{weekday(j.scheduled_date)}</span> {j.time_slot !== "any" && TIME_SLOT[j.time_slot]}</> : <span className="zero">미정</span>}</td>
                  <td>{waMark(j.work_area_code)}{j.kind !== "install" && <span className="badge badge-wait ml-1">{JOB_KIND[j.kind]}</span>}</td>
                  <td><span className="font-semibold">{j.customer_name}</span><div className="text-xs text-muted">{[j.site_name, j.site_unit].filter(Boolean).join(" ")}</div></td>
                  <td className="mono text-xs"><Link href={`/contracts/${j.contract_id}`}>{j.contract_no}</Link></td>
                  <td>{j.technician_name ?? <span className="zero">미배정</span>}</td>
                  <td><span className={`badge badge-${js.badge}`}>{js.label}</span></td>
                  <td className={`num ${Number(j.balance) ? "font-semibold" : "zero"}`}>{won(j.balance)}</td>
                  <td className="text-xs text-muted">{j.memo}</td>
                  {canAssign && (
                    <td>
                      {j.status !== "done" && (
                        <details>
                          <summary className="cursor-pointer text-accent text-xs">배정</summary>
                          <ActionForm action={quickAssign} className="mt-2 grid gap-2 min-w-[200px]">
                            <input type="hidden" name="id" value={j.id} />
                            <input type="date" name="scheduled_date" defaultValue={j.scheduled_date ?? ""} className="field mono" aria-label="예정일" />
                            <select name="time_slot" defaultValue={j.time_slot} className="field" aria-label="시간대"><option value="any">무관</option><option value="am">오전</option><option value="pm">오후</option></select>
                            {session.can("job.assign") && <select name="technician_id" defaultValue={j.technician_id ?? ""} className="field" aria-label="담당"><option value="">미배정</option>{techList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
                            <SubmitButton className="btn btn-sm">저장</SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={canAssign ? 9 : 8} className="text-muted">조건에 맞는 시공 건이 없습니다.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={canAssign ? 9 : 8}>{list.length}건</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}
