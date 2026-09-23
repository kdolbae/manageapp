import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues, labelOf } from "@/lib/codes";
import { phone, won, shortDate } from "@/lib/format";
import { CONTRACT_STATUS, JOB_STATUS, JOB_KIND, TIME_SLOT, APPROVAL, LEDGER_TYPE, workAreaClass } from "@/lib/contracts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { updateContract, setApproval, cancelContract, addLine, updateLine, deleteLine, addJob, updateJob, removeJob, addLedgerEntry, voidLedgerEntry } from "@/lib/actions/contracts";

export const metadata = { title: "계약" };

type Line = { id: string; product_id: string | null; name: string; work_area_code: string | null; qty: number; unit_price: number; discount: number; amount: number; technician_rate: number; memo: string | null };
type Job = { id: string; work_area_code: string | null; kind: string; status: string; scheduled_date: string | null; time_slot: string; technician_id: string | null; started_at: string | null; completed_at: string | null; memo: string | null; technician: { id: string; name: string } | null };
type Entry = { id: string; entry_type: string; amount: number; pay_method_code: string | null; occurred_at: string; memo: string | null; receipt_no: string | null; voided_at: string | null; void_reason: string | null; receiver: { display_name: string } | null; voider: { display_name: string } | null };
type History = { id: number; entity: string; entity_id: string; from_status: string | null; to_status: string; note: string | null; at: string };

function fmtDateTime(v: string) {
  const d = new Date(v);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default async function ContractPage({ params }: PageProps<"/contracts/[id]">) {
  const { id } = await params;
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();

  const { data: summary } = await supabase.from("contract_summary").select("*").eq("id", id).maybeSingle();
  if (!summary) notFound();

  const [{ data: contract }, { data: lines }, { data: jobs }, { data: entries }, workAreas, intakeTypes, payMethods, { data: branches }, { data: partners }, { data: members }, { data: technicians }] = await Promise.all([
    supabase
      .from("contract")
      .select("*, customer:customer(id, name, phone, address), site:site(id, name, address, dong, ho), partner:partner(id, name), branch:branch(id, name), sales_owner:profile!contract_sales_owner_id_fkey(display_name), approver:profile!contract_approved_by_fkey(display_name)")
      .eq("id", id)
      .single(),
    supabase.from("contract_line").select("*").eq("contract_id", id).order("sort_order").order("created_at"),
    supabase.from("job").select("*, technician:technician(id, name)").eq("contract_id", id).is("deleted_at", null).order("sort_order").order("created_at"),
    session.can("ledger.read")
      ? supabase.from("ledger_entry").select("*, receiver:profile!ledger_entry_received_by_fkey(display_name), voider:profile!ledger_entry_voided_by_fkey(display_name)").eq("contract_id", id).order("occurred_at", { ascending: false })
      : Promise.resolve({ data: [] as Entry[] }),
    codeValues(tid, "work_area"),
    codeValues(tid, "intake_type"),
    codeValues(tid, "pay_method"),
    supabase.from("branch").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("is_hq", { ascending: false }).order("name"),
    supabase.from("partner").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("name"),
    supabase.from("membership").select("profile_id, profile:profile(display_name)").eq("tenant_id", tid).eq("status", "active"),
    session.can("job.assign")
      ? supabase.from("technician").select("id, name, skills").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string; skills: string[] }[] }),
  ]);
  if (!contract) notFound();

  const jobList = (jobs ?? []) as unknown as Job[];
  const lineList = (lines ?? []) as Line[];
  const entryList = (entries ?? []) as unknown as Entry[];
  const memberList = (members ?? []) as unknown as { profile_id: string; profile: { display_name: string } | null }[];
  const techList = (technicians ?? []) as { id: string; name: string; skills: string[] }[];
  const { data: sites } = await supabase.from("site").select("id, name, dong, ho").eq("customer_id", contract.customer_id).is("deleted_at", null);
  const jobIds = jobList.map((j) => j.id);
  const [{ data: h1 }, { data: h2 }] = await Promise.all([
    supabase.from("status_history").select("*").eq("entity_id", id).order("at", { ascending: false }),
    jobIds.length ? supabase.from("status_history").select("*").in("entity_id", jobIds).order("at", { ascending: false }) : Promise.resolve({ data: [] as History[] }),
  ]);
  const history = ([...(h1 ?? []), ...(h2 ?? [])] as History[]).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);

  const st = CONTRACT_STATUS[summary.status] ?? { label: summary.status, badge: "wait" };
  const ap = APPROVAL[contract.approval_status];
  const canWrite = session.can("contract.write") && !contract.canceled_at;
  const canJob = session.can("job.write") && !contract.canceled_at;
  const canLedger = session.can("ledger.write") && !contract.canceled_at;
  const canRate = session.can("payout.read") || session.can("product.manage");
  const waMark = (code: string | null) => {
    const i = workAreas.findIndex((w) => w.code === code);
    if (i < 0) return null;
    const w = workAreas[i];
    return <span className="inline-flex items-center gap-1.5"><span className={`mark mark-${workAreaClass(w.color, i)}`}>{w.label.slice(0, 1)}</span>{w.label}</span>;
  };
  const balanceClass = summary.balance > 0 ? (summary.status === "done" ? "text-danger" : "") : "zero";

  return (
    <div>
      <div className="panel-head flex-wrap">
        <h1>
          <span className="mono">{contract.contract_no}</span>
          <span>{contract.customer?.name}</span>
          <span className={`badge badge-${st.badge}`}>{st.label}</span>
          {contract.approval_status !== "approved" && <span className={`badge badge-${ap.badge}`}>{ap.label}</span>}
        </h1>
        <div className="flex items-center gap-2">
          {session.can("contract.approve") && !contract.canceled_at && contract.approval_status === "pending" && (
            <>
              <ActionForm action={setApproval}><input type="hidden" name="id" value={id} /><input type="hidden" name="approval_status" value="approved" /><SubmitButton className="btn btn-primary">승인</SubmitButton></ActionForm>
              <ActionForm action={setApproval}><input type="hidden" name="id" value={id} /><input type="hidden" name="approval_status" value="rejected" /><SubmitButton className="btn btn-danger">반려</SubmitButton></ActionForm>
            </>
          )}
          {session.can("contract.approve") && !contract.canceled_at && contract.approval_status !== "pending" && (
            <ActionForm action={setApproval}><input type="hidden" name="id" value={id} /><input type="hidden" name="approval_status" value="pending" /><SubmitButton className="btn btn-sm">승인대기로</SubmitButton></ActionForm>
          )}
          <Link href="/contracts" className="btn">목록</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 border-b border-border bg-surface">
        <div className="stat"><div className="k">계약금액</div><div className="v">{won(summary.sale_total)}</div></div>
        <div className="stat"><div className="k">입금</div><div className="v text-muted">{won(summary.paid_total)}</div></div>
        <div className="stat"><div className="k">잔액</div><div className={`v ${balanceClass}`}>{won(summary.balance)}</div></div>
        <div className="stat"><div className="k">시공 건</div><div className="v">{summary.done_count}<span className="text-muted text-sm"> / {summary.job_count}</span></div></div>
        <div className="stat"><div className="k">다음 시공</div><div className="v">{summary.next_date ? shortDate(summary.next_date) : <span className="zero">—</span>}</div></div>
      </div>

      {contract.canceled_at && (
        <p className="notice notice-danger m-4">취소된 계약입니다 ({fmtDateTime(contract.canceled_at)}). 사유: {contract.cancel_reason}</p>
      )}

      <div className="p-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start">
        <div className="grid gap-4 min-w-0">
          {/* 품목 */}
          <section className="card overflow-x-auto">
            <div className="panel-head"><h2>품목 <span className="sub">{lineList.length}개</span></h2></div>
            <table className="tbl">
              <thead>
                <tr><th>품목</th><th>작업 단위</th><th className="text-right">단가</th><th className="text-right">수량</th><th className="text-right">할인</th><th className="text-right">금액</th>{canRate && <th className="text-right">기사비</th>}{canWrite && <th></th>}</tr>
              </thead>
              <tbody>
                {lineList.map((l) => (
                  <tr key={l.id}>
                    <td className="font-semibold">{l.name}{l.memo && <div className="text-xs text-muted font-normal">{l.memo}</div>}</td>
                    <td>{waMark(l.work_area_code) ?? <span className="zero">—</span>}</td>
                    <td className="num">{won(l.unit_price)}</td>
                    <td className="num">{Number(l.qty)}</td>
                    <td className={`num ${Number(l.discount) ? "" : "zero"}`}>{won(l.discount)}</td>
                    <td className="num font-semibold">{won(l.amount)}</td>
                    {canRate && <td className="num text-muted">{won(l.technician_rate)}</td>}
                    {canWrite && (
                      <td>
                        <details>
                          <summary className="cursor-pointer text-accent text-xs">수정</summary>
                          <ActionForm action={updateLine} className="mt-2 grid gap-2 min-w-[220px]">
                            <input type="hidden" name="id" value={l.id} /><input type="hidden" name="contract_id" value={id} />
                            <input name="unit_price" defaultValue={won(l.unit_price)} className="field mono text-right" aria-label="단가" />
                            <input name="qty" type="number" step="0.01" min="0.01" defaultValue={Number(l.qty)} className="field mono text-right" aria-label="수량" />
                            <input name="discount" defaultValue={won(l.discount)} className="field mono text-right" aria-label="할인" />
                            {canRate ? <input name="technician_rate" defaultValue={won(l.technician_rate)} className="field mono text-right" aria-label="기사비" /> : <input type="hidden" name="technician_rate" value={l.technician_rate} />}
                            <input name="memo" defaultValue={l.memo ?? ""} placeholder="메모" className="field" />
                            <div className="flex gap-2"><SubmitButton className="btn btn-sm">저장</SubmitButton></div>
                          </ActionForm>
                          <form action={deleteLine} className="mt-2"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="contract_id" value={id} /><button className="btn btn-sm btn-danger">삭제</button></form>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>품목 합계</td><td className="num text-text font-semibold">{won(summary.line_total)}</td>{canRate && <td className="num">{won(lineList.reduce((s, l) => s + Number(l.technician_rate) * Number(l.qty), 0))}</td>}{canWrite && <td></td>}</tr></tfoot>
            </table>
            {canWrite && (
              <details className="border-t border-border p-3">
                <summary className="cursor-pointer text-accent text-sm">품목 추가</summary>
                <ActionForm action={addLine} className="mt-2 grid gap-2 md:grid-cols-6 items-end">
                  <input type="hidden" name="contract_id" value={id} />
                  <div className="md:col-span-2"><label className="label">품목명</label><input name="name" required maxLength={80} className="field" /></div>
                  <div><label className="label">작업 단위</label><select name="work_area_code" className="field" defaultValue=""><option value="">없음</option>{workAreas.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}</select></div>
                  <div><label className="label">단가</label><input name="unit_price" defaultValue="0" className="field mono text-right" /></div>
                  <div><label className="label">수량</label><input name="qty" type="number" step="0.01" min="0.01" defaultValue={1} className="field mono text-right" /></div>
                  <div><label className="label">할인</label><input name="discount" defaultValue="0" className="field mono text-right" /></div>
                  {canRate ? <div><label className="label">기사비</label><input name="technician_rate" defaultValue="0" className="field mono text-right" /></div> : <input type="hidden" name="technician_rate" value="0" />}
                  <div><SubmitButton className="btn">추가</SubmitButton></div>
                </ActionForm>
              </details>
            )}
          </section>

          {/* 시공 건 */}
          <section className="card overflow-x-auto">
            <div className="panel-head"><h2>시공 건 <span className="sub">{jobList.length}건</span></h2></div>
            <table className="tbl">
              <thead><tr><th>작업 단위</th><th>구분</th><th>예정일</th><th>담당 기사</th><th>상태</th><th>메모</th><th></th></tr></thead>
              <tbody>
                {jobList.map((j) => {
                  const js = JOB_STATUS[j.status] ?? { label: j.status, badge: "wait" as const };
                  const mine = session.can("job.complete") && j.technician_id && techList.length === 0; // 기사 본인(배정 권한 없는 경우)
                  const editable = canJob || (mine && !contract.canceled_at);
                  return (
                    <tr key={j.id}>
                      <td>{waMark(j.work_area_code) ?? <span className="text-muted">전체</span>}</td>
                      <td>{JOB_KIND[j.kind] ?? j.kind}</td>
                      <td className="mono">{j.scheduled_date ? `${shortDate(j.scheduled_date)} ${j.time_slot !== "any" ? TIME_SLOT[j.time_slot] : ""}` : <span className="zero">미정</span>}</td>
                      <td>{j.technician?.name ?? <span className="zero">미배정</span>}</td>
                      <td><span className={`badge badge-${js.badge}`}>{js.label}</span></td>
                      <td className="text-muted text-xs">{j.memo}</td>
                      <td>
                        {editable && (
                          <details>
                            <summary className="cursor-pointer text-accent text-xs">변경</summary>
                            <ActionForm action={updateJob} className="mt-2 grid gap-2 min-w-[220px]">
                              <input type="hidden" name="id" value={j.id} /><input type="hidden" name="contract_id" value={id} />
                              {canJob && (
                                <>
                                  <input type="date" name="scheduled_date" defaultValue={j.scheduled_date ?? ""} className="field mono" aria-label="예정일" />
                                  <select name="time_slot" defaultValue={j.time_slot} className="field" aria-label="시간대"><option value="any">무관</option><option value="am">오전</option><option value="pm">오후</option></select>
                                  {session.can("job.assign") && (
                                    <select name="technician_id" defaultValue={j.technician_id ?? ""} className="field" aria-label="담당 기사">
                                      <option value="">미배정</option>
                                      {techList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                  )}
                                </>
                              )}
                              <select name="status" defaultValue={j.status} className="field" aria-label="상태">
                                {Object.entries(JOB_STATUS).filter(([k]) => canJob || ["assigned", "in_progress", "done", "postponed"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                              </select>
                              <input name="memo" defaultValue={j.memo ?? ""} placeholder="메모" className="field" />
                              <SubmitButton className="btn btn-sm">저장</SubmitButton>
                            </ActionForm>
                            {canJob && <form action={removeJob} className="mt-2"><input type="hidden" name="id" value={j.id} /><input type="hidden" name="contract_id" value={id} /><button className="btn btn-sm btn-danger">시공 건 삭제</button></form>}
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {jobList.length === 0 && <tr><td colSpan={7} className="text-muted">시공 건이 없습니다.</td></tr>}
              </tbody>
            </table>
            {canJob && (
              <details className="border-t border-border p-3">
                <summary className="cursor-pointer text-accent text-sm">시공 건 추가 (AS·하자보수 포함)</summary>
                <ActionForm action={addJob} className="mt-2 grid gap-2 md:grid-cols-6 items-end">
                  <input type="hidden" name="contract_id" value={id} />
                  <div><label className="label">작업 단위</label><select name="work_area_code" className="field" defaultValue=""><option value="">전체</option>{workAreas.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}</select></div>
                  <div><label className="label">구분</label><select name="kind" className="field" defaultValue="install">{Object.entries(JOB_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div><label className="label">예정일</label><input type="date" name="scheduled_date" className="field mono" /></div>
                  <div><label className="label">시간대</label><select name="time_slot" className="field" defaultValue="any"><option value="any">무관</option><option value="am">오전</option><option value="pm">오후</option></select></div>
                  {session.can("job.assign") ? <div><label className="label">담당</label><select name="technician_id" className="field" defaultValue=""><option value="">미배정</option>{techList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div> : <input type="hidden" name="technician_id" value="" />}
                  <div><SubmitButton className="btn">추가</SubmitButton></div>
                  <div className="md:col-span-6"><input name="memo" placeholder="메모" className="field" /></div>
                </ActionForm>
              </details>
            )}
          </section>

          {/* 원장 */}
          {session.can("ledger.read") && (
            <section className="card overflow-x-auto">
              <div className="panel-head"><h2>수납·원장 <span className="sub">잔액 {won(summary.balance)}</span></h2></div>
              <table className="tbl">
                <thead><tr><th>일시</th><th>유형</th><th className="text-right">금액</th><th>결제수단</th><th>수납자</th><th>메모</th><th></th></tr></thead>
                <tbody>
                  {entryList.map((e) => {
                    const t = LEDGER_TYPE[e.entry_type] ?? { label: e.entry_type, side: "payment" as const, sign: 1 as const };
                    return (
                      <tr key={e.id} className={e.voided_at ? "opacity-60" : ""}>
                        <td className="mono text-muted">{fmtDateTime(e.occurred_at)}</td>
                        <td><span className={`badge ${e.voided_at ? "badge-risk" : t.side === "payment" ? (t.sign > 0 ? "badge-done" : "badge-risk") : "badge-wait"}`}>{t.label}{e.voided_at ? " · 취소됨" : ""}</span></td>
                        <td className={`num ${e.voided_at ? "line-through" : ""}`}>{t.sign < 0 ? "-" : ""}{won(e.amount)}</td>
                        <td>{labelOf(payMethods, e.pay_method_code) || <span className="zero">—</span>}</td>
                        <td>{e.receiver?.display_name ?? "—"}</td>
                        <td className="text-xs text-muted">{e.memo}{e.receipt_no && <span className="mono"> · {e.receipt_no}</span>}{e.voided_at && <div>취소: {e.void_reason} ({e.voider?.display_name})</div>}</td>
                        <td>
                          {!e.voided_at && session.can("ledger.void") && (
                            <details>
                              <summary className="cursor-pointer text-danger text-xs">취소</summary>
                              <ActionForm action={voidLedgerEntry} className="mt-2 grid gap-2 min-w-[200px]">
                                <input type="hidden" name="id" value={e.id} /><input type="hidden" name="contract_id" value={id} />
                                <input name="reason" required maxLength={200} placeholder="취소 사유" className="field" />
                                <SubmitButton className="btn btn-sm btn-danger">기록 취소</SubmitButton>
                              </ActionForm>
                            </details>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {entryList.length === 0 && <tr><td colSpan={7} className="text-muted">기록이 없습니다.</td></tr>}
                </tbody>
              </table>
              {canLedger && (
                <details className="border-t border-border p-3" open={entryList.length === 0}>
                  <summary className="cursor-pointer text-accent text-sm">수납·조정 기록</summary>
                  <ActionForm action={addLedgerEntry} className="mt-2 grid gap-2 md:grid-cols-6 items-end">
                    <input type="hidden" name="contract_id" value={id} />
                    <div><label className="label">유형</label><select name="entry_type" className="field" defaultValue={summary.paid_total > 0 ? "balance" : "deposit"}>{Object.entries(LEDGER_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
                    <div><label className="label">금액</label><input name="amount" required defaultValue={summary.balance > 0 ? won(summary.balance) : ""} className="field mono text-right" /></div>
                    <div><label className="label">결제수단</label><select name="pay_method_code" className="field" defaultValue=""><option value="">—</option>{payMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select></div>
                    <div><label className="label">일자</label><input type="date" name="occurred_at" defaultValue={new Date().toISOString().slice(0, 10)} className="field mono" /></div>
                    <div><label className="label">시공 건</label><select name="job_id" className="field" defaultValue=""><option value="">—</option>{jobList.map((j) => <option key={j.id} value={j.id}>{labelOf(workAreas, j.work_area_code) || "전체"} {j.scheduled_date ? shortDate(j.scheduled_date) : ""}</option>)}</select></div>
                    <div><SubmitButton className="btn btn-primary">기록</SubmitButton></div>
                    <div className="md:col-span-4"><input name="memo" placeholder="메모" className="field" /></div>
                    <div className="md:col-span-2"><input name="receipt_no" placeholder="영수증·승인번호" className="field mono" /></div>
                  </ActionForm>
                </details>
              )}
            </section>
          )}
        </div>

        <div className="grid gap-4 min-w-0">
          <section className="card p-4 text-sm grid gap-2">
            <h2 className="text-sm font-semibold">계약 정보</h2>
            <div className="grid grid-cols-[88px_1fr] gap-y-1.5 gap-x-2">
              <span className="text-muted">계약자</span><span><Link href={`/people/customers/${contract.customer_id}`} className="font-semibold">{contract.customer?.name}</Link> <span className="mono text-muted">{phone(contract.customer?.phone)}</span></span>
              <span className="text-muted">현장</span><span>{contract.site ? `${contract.site.name} ${[contract.site.dong && `${contract.site.dong}동`, contract.site.ho && `${contract.site.ho}호`].filter(Boolean).join(" ")}` : "—"}<div className="text-xs text-muted">{contract.site?.address}</div></span>
              <span className="text-muted">계약일</span><span className="mono">{contract.contract_date}</span>
              <span className="text-muted">지점</span><span>{contract.branch?.name ?? "—"}</span>
              <span className="text-muted">접수 형태</span><span>{labelOf(intakeTypes, contract.intake_type_code) || "—"}</span>
              <span className="text-muted">발주처</span><span>{contract.partner?.name ?? "직접 계약"}</span>
              <span className="text-muted">영업 담당</span><span>{contract.sales_owner?.display_name ?? "—"}</span>
              <span className="text-muted">승인</span><span>{ap.label}{contract.approver && ` · ${contract.approver.display_name}`}{contract.approved_at && <span className="text-muted"> {fmtDateTime(contract.approved_at)}</span>}</span>
              <span className="text-muted">메모</span><span className="whitespace-pre-wrap">{contract.memo ?? "—"}</span>
            </div>
            {canWrite && (
              <details className="mt-2">
                <summary className="cursor-pointer text-accent text-xs">계약 정보 수정</summary>
                <ActionForm action={updateContract} className="mt-2 grid gap-2">
                  <input type="hidden" name="id" value={id} />
                  <div><label className="label">계약일</label><input type="date" name="contract_date" defaultValue={contract.contract_date} className="field mono" /></div>
                  <div><label className="label">현장</label><select name="site_id" defaultValue={contract.site_id ?? ""} className="field"><option value="">—</option>{(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} {s.dong && `${s.dong}동`} {s.ho && `${s.ho}호`}</option>)}</select></div>
                  <div><label className="label">지점</label><select name="branch_id" defaultValue={contract.branch_id ?? ""} className="field"><option value="">없음</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                  <div><label className="label">접수 형태</label><select name="intake_type_code" defaultValue={contract.intake_type_code ?? ""} className="field"><option value="">—</option>{intakeTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></div>
                  <div><label className="label">발주처</label><select name="partner_id" defaultValue={contract.partner_id ?? ""} className="field"><option value="">직접 계약</option>{(partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                  <div><label className="label">영업 담당</label><select name="sales_owner_id" defaultValue={contract.sales_owner_id ?? ""} className="field"><option value="">—</option>{memberList.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.profile?.display_name}</option>)}</select></div>
                  <div><label className="label">메모</label><textarea name="memo" defaultValue={contract.memo ?? ""} className="field" maxLength={1000} /></div>
                  <SubmitButton className="btn btn-sm">저장</SubmitButton>
                </ActionForm>
              </details>
            )}
            {canWrite && (
              <details className="mt-1">
                <summary className="cursor-pointer text-danger text-xs">계약 취소</summary>
                <ActionForm action={cancelContract} className="mt-2 grid gap-2">
                  <input type="hidden" name="id" value={id} />
                  <input name="reason" required maxLength={300} placeholder="취소 사유" className="field" />
                  <SubmitButton className="btn btn-sm btn-danger">이 계약을 취소</SubmitButton>
                </ActionForm>
              </details>
            )}
          </section>

          <section className="card p-4 text-xs">
            <h2 className="text-sm font-semibold mb-2">이력</h2>
            <ul className="grid gap-1.5">
              {history.map((h) => {
                const isJob = h.entity === "job";
                const job = isJob ? jobList.find((j) => j.id === h.entity_id) : null;
                const label = h.entity === "contract_approval" ? `승인 ${APPROVAL[h.to_status]?.label ?? h.to_status}` : h.entity === "contract" ? `계약 ${h.to_status === "canceled" ? "취소" : h.to_status}` : `${labelOf(workAreas, job?.work_area_code) || "시공"} ${JOB_STATUS[h.to_status]?.label ?? h.to_status}`;
                return <li key={h.id} className="flex gap-2"><span className="mono text-muted w-[84px] flex-none">{fmtDateTime(h.at)}</span><span>{label}{h.note && <span className="text-muted"> · {h.note}</span>}</span></li>;
              })}
              {history.length === 0 && <li className="text-muted">이력이 없습니다.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
