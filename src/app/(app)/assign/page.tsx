import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { todayKST, addDays, weekday, mmdd, isValidYmd } from "@/lib/dates";
import { JOB_STATUS, TIME_SLOT, workAreaClass } from "@/lib/contracts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { quickAssign, setCapacity, toggleOff } from "@/lib/actions/jobs";

export const metadata = { title: "시공 배정" };

const DAYS = 7;
type Job = { id: string; contract_id: string; contract_no: string; work_area_code: string | null; kind: string; status: string; scheduled_date: string | null; time_slot: string; technician_id: string | null; customer_name: string | null; site_name: string | null; site_unit: string | null; branch_id: string | null; approval_status: string };
type Tech = { id: string; name: string; branch_id: string | null; skills: string[] };

export default async function AssignPage({ searchParams }: PageProps<"/assign">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const start = isValidYmd(sp.start) ? sp.start : todayKST();
  const end = addDays(start, DAYS - 1);
  const branch = typeof sp.branch === "string" ? sp.branch : (session.current.branch_id ?? "");
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  const supabase = await createClient();
  const canAssign = session.can("job.assign");

  if (!canAssign && !session.can("job.write")) {
    return <div><div className="panel-head"><h1>시공 배정</h1></div><p className="p-4 text-sm text-muted">배정 권한이 없습니다.</p></div>;
  }

  let techQ = supabase.from("technician").select("id, name, branch_id, skills").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("sort_order").order("name");
  if (branch) techQ = techQ.or(`branch_id.eq.${branch},branch_id.is.null`);
  let jobQ = supabase.from("job_summary").select("*").eq("tenant_id", tid).neq("status", "canceled").gte("scheduled_date", start).lte("scheduled_date", end);
  if (branch) jobQ = jobQ.eq("branch_id", branch);
  let pendingQ = supabase.from("job_summary").select("*").eq("tenant_id", tid).not("status", "in", "(done,canceled)").or("technician_id.is.null,scheduled_date.is.null").order("scheduled_date", { ascending: true, nullsFirst: false }).limit(200);
  if (branch) pendingQ = pendingQ.eq("branch_id", branch);
  let capQ = supabase.from("daily_capacity").select("date, branch_id, max_jobs").eq("tenant_id", tid).gte("date", start).lte("date", end);
  capQ = branch ? capQ.or(`branch_id.eq.${branch},branch_id.is.null`) : capQ.is("branch_id", null);

  const [{ data: techs }, { data: jobs }, { data: pending }, { data: caps }, { data: offs }, workAreas, { data: branches }] = await Promise.all([
    techQ,
    jobQ.order("time_slot"),
    pendingQ,
    capQ,
    supabase.from("technician_off").select("technician_id, date").eq("tenant_id", tid).gte("date", start).lte("date", end),
    codeValues(tid, "work_area"),
    supabase.from("branch").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("is_hq", { ascending: false }).order("name"),
  ]);
  const techList = (techs ?? []) as Tech[];
  const jobList = (jobs ?? []) as Job[];
  const pendingList = ((pending ?? []) as Job[]).filter((j) => !j.technician_id || !j.scheduled_date || j.scheduled_date < start || j.scheduled_date > end);
  const capOf = (d: string) => {
    const rows = (caps ?? []).filter((c) => c.date === d);
    return rows.find((c) => branch && c.branch_id === branch)?.max_jobs ?? rows.find((c) => !c.branch_id)?.max_jobs ?? null;
  };
  const offSet = new Set((offs ?? []).map((o) => `${o.technician_id}:${o.date}`));
  const waOf = (code: string | null) => {
    const i = workAreas.findIndex((w) => w.code === code);
    if (i < 0) return null;
    return { ...workAreas[i], cls: workAreaClass(workAreas[i].color, i) };
  };
  const today = todayKST();

  const chip = (j: Job, key: string) => {
    const wa = waOf(j.work_area_code);
    const js = JOB_STATUS[j.status] ?? { label: j.status, badge: "wait" as const };
    return (
      <details key={key} className={`card text-xs mb-1.5 ${j.status === "done" ? "opacity-60" : ""}`} style={{ borderLeft: wa ? `4px ${wa.cls === "wa2" ? "dashed" : "solid"} var(--${wa.cls})` : undefined }}>
        <summary className="cursor-pointer p-1.5 list-none">
          <div className="flex items-center gap-1.5">
            {wa && <span className={`mark mark-${wa.cls}`} style={{ width: 16, height: 16, fontSize: 10 }}>{wa.label.slice(0, 1)}</span>}
            <span className="font-semibold truncate">{j.customer_name}</span>
            {j.time_slot !== "any" && <span className="mono text-muted">{TIME_SLOT[j.time_slot]}</span>}
          </div>
          <div className="text-muted truncate">{[j.site_name, j.site_unit].filter(Boolean).join(" ")}</div>
          <div className="flex items-center gap-1 mt-0.5"><span className={`badge badge-${js.badge}`}>{js.label}</span>{j.approval_status === "pending" && <span className="badge badge-wait">승인대기</span>}</div>
        </summary>
        <div className="p-1.5 border-t border-border">
          <ActionForm action={quickAssign} className="grid gap-1.5">
            <input type="hidden" name="id" value={j.id} />
            <input type="date" name="scheduled_date" defaultValue={j.scheduled_date ?? ""} className="field h-8 text-xs mono" aria-label="예정일" />
            <select name="time_slot" defaultValue={j.time_slot} className="field h-8 text-xs" aria-label="시간대"><option value="any">무관</option><option value="am">오전</option><option value="pm">오후</option></select>
            {canAssign && (
              <select name="technician_id" defaultValue={j.technician_id ?? ""} className="field h-8 text-xs" aria-label="담당">
                <option value="">미배정</option>
                {techList.filter((t) => !j.work_area_code || t.skills.length === 0 || t.skills.includes(j.work_area_code)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <div className="flex gap-1"><SubmitButton className="btn btn-sm">저장</SubmitButton><Link href={`/contracts/${j.contract_id}`} className="btn btn-sm">계약</Link></div>
          </ActionForm>
        </div>
      </details>
    );
  };

  return (
    <div>
      <div className="panel-head">
        <h1>시공 배정 <span className="sub">{mmdd(start)} ~ {mmdd(end)} · 기사 {techList.length}명</span></h1>
        <div className="flex items-center gap-1.5">
          <Link href={`/assign?start=${addDays(start, -7)}&branch=${branch}`} className="btn btn-sm">이전 주</Link>
          <Link href={`/assign?start=${today}&branch=${branch}`} className="btn btn-sm">오늘</Link>
          <Link href={`/assign?start=${addDays(start, 7)}&branch=${branch}`} className="btn btn-sm">다음 주</Link>
          {(branches ?? []).length > 1 && (
            <form method="get"><input type="hidden" name="start" value={start} />
              <select name="branch" defaultValue={branch} className="field h-8 text-xs w-[120px]" aria-label="지점">
                <option value="">모든 지점</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </form>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tbl" style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={{ width: 130 }}>기사</th>
              {days.map((d) => {
                const count = jobList.filter((j) => j.scheduled_date === d).length;
                const cap = capOf(d);
                const over = cap !== null && count > cap;
                const wd = weekday(d);
                return (
                  <th key={d} className={d === today ? "text-accent" : wd === "일" ? "text-danger" : wd === "토" ? "text-accent" : ""}>
                    <div className="flex items-center justify-between gap-1">
                      <span>{mmdd(d)} {wd}</span>
                      <span className={`mono ${over ? "text-danger font-bold" : "text-muted"}`}>{count}{cap !== null ? `/${cap}` : ""}</span>
                    </div>
                    {canAssign && (
                      <details className="font-normal">
                        <summary className="cursor-pointer text-[10.5px] text-muted list-none">캐파</summary>
                        <ActionForm action={setCapacity} className="flex gap-1 mt-1">
                          <input type="hidden" name="date" value={d} /><input type="hidden" name="branch_id" value={branch} />
                          <input name="max_jobs" type="number" min={0} defaultValue={cap ?? ""} className="field h-7 text-xs mono w-[60px]" aria-label="최대 건수" />
                          <SubmitButton className="btn btn-sm h-7">저장</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {techList.map((t) => (
              <tr key={t.id}>
                <td className="align-top">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-[10.5px] text-muted">{t.skills.map((s) => waOf(s)?.label ?? s).join("·")}</div>
                  <div className="mono text-[10.5px] text-muted">{days.filter((d) => jobList.some((j) => j.technician_id === t.id && j.scheduled_date === d)).length}일 {jobList.filter((j) => j.technician_id === t.id).length}건</div>
                </td>
                {days.map((d) => {
                  const off = offSet.has(`${t.id}:${d}`);
                  const cell = jobList.filter((j) => j.technician_id === t.id && j.scheduled_date === d);
                  return (
                    <td key={d} className="align-top" style={{ background: off ? "var(--zebra)" : undefined, minWidth: 130 }}>
                      {off && <div className="text-[10.5px] text-muted mb-1">휴무</div>}
                      {cell.map((j) => chip(j, j.id))}
                      {canAssign && (
                        <form action={toggleOff}>
                          <input type="hidden" name="technician_id" value={t.id} /><input type="hidden" name="date" value={d} /><input type="hidden" name="on" value={off ? "0" : "1"} />
                          <button className="text-[10.5px] text-muted hover:text-text">{off ? "휴무 해제" : "휴무"}</button>
                        </form>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="align-top font-semibold text-warn">미배정</td>
              {days.map((d) => (
                <td key={d} className="align-top">{jobList.filter((j) => !j.technician_id && j.scheduled_date === d).map((j) => chip(j, j.id))}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <section className="p-4">
        <div className="card">
          <div className="panel-head"><h2>배정·날짜가 필요한 시공 건 <span className="sub">{pendingList.length}건</span></h2></div>
          <div className="p-3 grid gap-1.5 md:grid-cols-3 xl:grid-cols-4">
            {pendingList.map((j) => chip(j, `p-${j.id}`))}
            {pendingList.length === 0 && <p className="text-sm text-muted">모두 배정되었습니다.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
