import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { won, phone } from "@/lib/format";
import { todayKST, addDays, weekday, mmdd, isValidYmd } from "@/lib/dates";
import { JOB_STATUS, JOB_KIND, TIME_SLOT, workAreaClass } from "@/lib/contracts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { setJobStatus } from "@/lib/actions/jobs";
import { addLedgerEntry } from "@/lib/actions/contracts";

export const metadata = { title: "오늘 시공" };

type Job = { id: string; contract_id: string; contract_no: string; work_area_code: string | null; kind: string; status: string; scheduled_date: string | null; time_slot: string; technician_id: string | null; technician_name: string | null; customer_name: string | null; customer_phone: string | null; site_name: string | null; site_unit: string | null; sale_total: number; paid_total: number; balance: number; memo: string | null };

export default async function TodayPage({ searchParams }: PageProps<"/jobs/today">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const date = isValidYmd(sp.date) ? sp.date : todayKST();
  const supabase = await createClient();

  // 기사 계정이면 RLS 가 본인 시공 건만 돌려준다. 관리자는 담당 기사 필터로 본다.
  const { data: myTech } = await supabase.from("technician").select("id, name").eq("tenant_id", tid).eq("profile_id", session.user.id).is("deleted_at", null).maybeSingle();
  let q = supabase.from("job_summary").select("*").eq("tenant_id", tid).eq("scheduled_date", date).neq("status", "canceled");
  if (myTech) q = q.eq("technician_id", myTech.id);
  const [{ data: jobs }, workAreas, payMethods, { data: sites }] = await Promise.all([
    q.order("time_slot").order("created_at"),
    codeValues(tid, "work_area"),
    codeValues(tid, "pay_method"),
    supabase.from("site").select("id, address").limit(200),
  ]);
  const list = (jobs ?? []) as Job[];
  const jobIds = list.map((j) => j.id);
  const { data: jl } = jobIds.length ? await supabase.from("job_line").select("job_id, line:contract_line(amount, name)").in("job_id", jobIds) : { data: [] };
  const lineAmount = (jobId: string) => ((jl ?? []) as unknown as { job_id: string; line: { amount: number; name: string } | null }[]).filter((x) => x.job_id === jobId).reduce((s, x) => s + Number(x.line?.amount ?? 0), 0);
  const siteAddr = new Map((sites ?? []).map((s) => [s.id, s.address]));
  const canLedger = session.can("ledger.write");

  return (
    <div className="max-w-[640px]">
      <div className="panel-head">
        <h1>오늘 시공 <span className="sub">{mmdd(date)} {weekday(date)} · {list.length}건{myTech ? ` · ${myTech.name}` : ""}</span></h1>
        <div className="flex gap-1"><Link href={`/jobs/today?date=${addDays(date, -1)}`} className="btn btn-sm">어제</Link><Link href="/jobs/today" className="btn btn-sm">오늘</Link><Link href={`/jobs/today?date=${addDays(date, 1)}`} className="btn btn-sm">내일</Link></div>
      </div>
      <div className="p-3.5 grid gap-3">
        {list.map((j) => {
          const i = workAreas.findIndex((w) => w.code === j.work_area_code);
          const wa = i >= 0 ? { ...workAreas[i], cls: workAreaClass(workAreas[i].color, i) } : null;
          const js = JOB_STATUS[j.status] ?? { label: j.status, badge: "wait" as const };
          const own = lineAmount(j.id);
          const addr = (j as unknown as { site_id: string | null }).site_id ? siteAddr.get((j as unknown as { site_id: string }).site_id) : null;
          return (
            <div key={j.id} className="card p-3.5" style={{ borderLeft: wa ? `4px ${wa.cls === "wa2" ? "dashed" : "solid"} var(--${wa.cls})` : undefined }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-[15px] font-bold">
                  {wa && <span className={`mark mark-${wa.cls}`}>{wa.label.slice(0, 1)}</span>}
                  {wa?.label ?? "시공"} {JOB_KIND[j.kind] !== "시공" && JOB_KIND[j.kind]}
                  <span className={`badge badge-${js.badge}`}>{js.label}</span>
                </div>
                <div className="mono text-[15px] font-semibold">{j.time_slot !== "any" ? TIME_SLOT[j.time_slot] : "시간 무관"}</div>
              </div>
              <div className="mt-2 text-[14px] font-semibold">{j.customer_name} {j.customer_phone && <a href={`tel:${j.customer_phone}`} className="mono font-normal ml-1">{phone(j.customer_phone)}</a>}</div>
              <div className="text-[13px] text-muted leading-relaxed">{[j.site_name, j.site_unit].filter(Boolean).join(" ")}{addr && <div>{addr}</div>}</div>
              {j.memo && <div className="text-xs text-muted mt-1">메모: {j.memo}</div>}
              <div className="grid grid-cols-2 gap-px bg-border mt-3 border border-border">
                <div className="bg-surface p-2"><div className="text-[11.5px] text-muted">이 시공 금액</div><div className="mono text-[16px] font-semibold">{won(own || j.sale_total)}</div></div>
                <div className="bg-surface p-2"><div className="text-[11.5px] text-muted">받을 잔금</div><div className={`mono text-[16px] font-bold ${Number(j.balance) > 0 ? "text-danger" : "text-success"}`}>{Number(j.balance) > 0 ? won(j.balance) : "수납 완료"}</div></div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {j.status !== "done" && j.status !== "in_progress" && (
                  <ActionForm action={setJobStatus}><input type="hidden" name="id" value={j.id} /><input type="hidden" name="status" value="in_progress" /><SubmitButton className="btn btn-primary w-full">시공 시작</SubmitButton></ActionForm>
                )}
                {j.status === "in_progress" && (
                  <ActionForm action={setJobStatus}><input type="hidden" name="id" value={j.id} /><input type="hidden" name="status" value="done" /><SubmitButton className="btn btn-primary w-full">시공 완료</SubmitButton></ActionForm>
                )}
                {j.status === "done" && <div className="btn w-full text-success">완료됨</div>}
                {addr ? <a href={`https://map.kakao.com/link/search/${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer" className="btn w-full">길 안내</a> : <Link href={`/contracts/${j.contract_id}`} className="btn w-full">계약 보기</Link>}
              </div>
              {canLedger && Number(j.balance) > 0 && (
                <details className="mt-2">
                  <summary className="btn w-full cursor-pointer">잔금 수납 기록</summary>
                  <ActionForm action={addLedgerEntry} className="mt-2 grid gap-2">
                    <input type="hidden" name="contract_id" value={j.contract_id} /><input type="hidden" name="job_id" value={j.id} /><input type="hidden" name="entry_type" value="balance" />
                    <input name="amount" defaultValue={won(j.balance)} className="field mono text-right text-[16px]" aria-label="금액" />
                    <select name="pay_method_code" className="field" defaultValue={payMethods[0]?.code ?? ""} aria-label="결제수단">{payMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select>
                    <input name="memo" placeholder="메모" className="field" />
                    <SubmitButton className="btn btn-primary">수납 기록</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </div>
          );
        })}
        {list.length === 0 && <div className="card p-6 text-center text-sm text-muted">{mmdd(date)} 에 배정된 시공이 없습니다.</div>}
      </div>
    </div>
  );
}
