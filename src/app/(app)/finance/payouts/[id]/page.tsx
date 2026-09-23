import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won, maskAccount } from "@/lib/format";
import { mmdd } from "@/lib/dates";
import { fmtDateTime } from "@/lib/inbox";
import { codeValues, labelOf } from "@/lib/codes";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { setPayoutStatus, deletePayout, addPayoutLine, removePayoutLine } from "@/lib/actions/finance";
import { Crumb, KV } from "@/app/(app)/people/shared";
import { PAYOUT_STATUS, PAYOUT_LINE_KIND, RATE_TYPE } from "@/lib/finance";

export const metadata = { title: "정산서" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Payout = {
  id: string;
  technician_id: string;
  period_from: string;
  period_to: string;
  rate_type: string;
  gross: number;
  withholding: number;
  vat: number;
  net: number;
  status: string;
  confirmed_at: string | null;
  paid_at: string | null;
  pay_method_code: string | null;
  memo: string | null;
  created_at: string;
  technician: { name: string; rate_type: string; bank_name: string | null; bank_account: string | null; bank_holder: string | null; profile_id: string | null } | null;
  branch: { name: string } | null;
  confirmer: { display_name: string } | null;
};
type Line = {
  id: string;
  kind: string;
  job_id: string | null;
  line_id: string | null;
  contract_id: string | null;
  work_on: string | null;
  amount: number;
  memo: string | null;
  contract: { contract_no: string } | null;
};

export default async function PayoutPage({ params }: PageProps<"/finance/payouts/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  const canApprove = session.can("payout.approve");
  const isTechnician = session.current.role.code === "technician";
  if (!session.can("payout.read") && !canApprove && !isTechnician) return <p className="p-4 text-sm text-muted">기사 정산을 볼 수 있는 권한이 없습니다.</p>;
  const tid = session.current.tenant_id;
  const supabase = await createClient();

  const [{ data }, { data: lRows }, payMethods] = await Promise.all([
    supabase
      .from("payout")
      .select(
        "id, technician_id, period_from, period_to, rate_type, gross, withholding, vat, net, status, confirmed_at, paid_at, pay_method_code, memo, created_at, " +
          "technician:technician(name, rate_type, bank_name, bank_account, bank_holder, profile_id), branch:branch(name), confirmer:profile!payout_confirmed_by_fkey(display_name)",
      )
      .eq("id", id)
      .eq("tenant_id", tid)
      .maybeSingle(),
    supabase.from("payout_line").select("id, kind, job_id, line_id, contract_id, work_on, amount, memo, contract:contract(contract_no)").eq("payout_id", id).eq("tenant_id", tid).order("work_on").order("created_at"),
    codeValues(tid, "pay_method"),
  ]);
  if (!data) notFound();
  const p = data as unknown as Payout;
  const lines = (lRows ?? []) as unknown as Line[];
  const t = p.technician;
  const st = PAYOUT_STATUS[p.status] ?? { label: p.status, badge: "wait" as const };
  // 계좌 전체는 정산 승인 권한자와 기사 본인만. 그 외에는 가려서 보여준다.
  const bankVisible = canApprove || Boolean(t && t.profile_id && t.profile_id === session.user.id);
  const hasBank = Boolean(t && (t.bank_name || t.bank_account || t.bank_holder));
  const isDraft = p.status === "draft";
  const editable = canApprove && p.status !== "paid";
  const lineEditable = canApprove && isDraft;
  const jobLines = lines.filter((l) => l.kind === "job").length;
  const withholding = Number(p.withholding);
  const vat = Number(p.vat);
  const cols = lineEditable ? 6 : 5;
  const defaultPay = p.pay_method_code ?? (payMethods.some((x) => x.code === "transfer") ? "transfer" : "");

  return (
    <div className="p-4">
      <Crumb href="/finance/payouts" parent="기사 정산" current={`${t?.name ?? "시공자"} · ${p.period_from} ~ ${p.period_to}`} />
      <div className={"grid gap-4 items-start" + (editable ? " lg:grid-cols-[1fr_340px]" : "")}>
        <div className="grid gap-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="text-base font-semibold">{t?.name ?? "(시공자)"} 정산서</h2>
              <span className={`badge badge-${st.badge}`}>{st.label}</span>
              <span className="text-xs text-muted">{RATE_TYPE[p.rate_type] ?? p.rate_type}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 border border-border rounded-sm mb-3">
              <div className="stat"><div className="k">지급 대상</div><div className={`v ${Number(p.gross) ? "" : "zero"}`}>{won(p.gross)}</div></div>
              <div className="stat"><div className="k">원천징수 3.3%</div><div className={`v ${withholding ? "text-danger" : "zero"}`}>{withholding ? `-${won(withholding)}` : "0"}</div></div>
              <div className="stat"><div className="k">부가세 10%</div><div className={`v ${vat ? "" : "zero"}`}>{vat ? `+${won(vat)}` : "0"}</div></div>
              <div className="stat"><div className="k">실지급</div><div className={`v ${Number(p.net) ? "text-success" : "zero"}`}>{won(p.net)}</div></div>
            </div>
            <KV k="기간"><span className="mono">{p.period_from} ~ {p.period_to}</span></KV>
            <KV k="지점">{p.branch?.name ?? "본사 공통"}</KV>
            <KV k="정산 방식">
              {RATE_TYPE[p.rate_type] ?? p.rate_type}
              {t && t.rate_type !== p.rate_type && <span className="text-xs text-muted ml-2">시공자의 현재 설정은 {RATE_TYPE[t.rate_type] ?? t.rate_type}</span>}
            </KV>
            <KV k="입금 계좌">
              {!hasBank ? (
                <span className="text-muted">등록된 계좌가 없습니다</span>
              ) : (
                <>
                  {t?.bank_name} <span className="mono">{bankVisible ? t?.bank_account : maskAccount(t?.bank_account)}</span>
                  {t?.bank_holder && <span className="text-muted ml-2">예금주 {t.bank_holder}</span>}
                </>
              )}
            </KV>
            <KV k="확정">
              {p.confirmed_at ? (
                <>
                  <span className="mono">{fmtDateTime(p.confirmed_at)}</span>
                  {p.confirmer && <span className="text-muted ml-2">{p.confirmer.display_name}</span>}
                </>
              ) : (
                <span className="text-muted">—</span>
              )}
            </KV>
            <KV k="지급">
              {p.paid_at ? (
                <>
                  <span className="mono">{fmtDateTime(p.paid_at)}</span>
                  {p.pay_method_code && <span className="text-muted ml-2">{labelOf(payMethods, p.pay_method_code)}</span>}
                </>
              ) : (
                <span className="text-muted">—</span>
              )}
            </KV>
            {p.memo && <KV k="메모"><span className="whitespace-pre-wrap">{p.memo}</span></KV>}
            {p.status === "paid" && canApprove && <p className="text-xs text-muted mt-3">지급 완료된 정산서는 바꿀 수 없습니다.</p>}
          </div>

          <div className="card overflow-x-auto">
            <div className="panel-head">
              <h2>정산 줄 <span className="sub">시공 {jobLines} · 기타 {lines.length - jobLines}</span></h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>일자</th>
                  <th>구분</th>
                  <th>계약</th>
                  <th>품목 · 메모</th>
                  <th className="text-right">금액</th>
                  {lineEditable && <th></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="mono text-xs">{l.work_on ? mmdd(l.work_on) : <span className="zero">—</span>}</td>
                    <td><span className={`badge ${l.kind === "deduct" ? "badge-risk" : l.kind === "job" ? "badge-run" : "badge-wait"}`}>{PAYOUT_LINE_KIND[l.kind] ?? l.kind}</span></td>
                    <td className="mono text-xs">{l.contract_id ? <Link href={`/contracts/${l.contract_id}`}>{l.contract?.contract_no ?? "계약"}</Link> : <span className="zero">—</span>}</td>
                    <td className="text-xs">{l.memo ?? ""}</td>
                    <td className={`num ${Number(l.amount) < 0 ? "text-danger" : ""}`}>{won(l.amount)}</td>
                    {lineEditable && (
                      <td>
                        <ActionForm action={removePayoutLine}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="payout_id" value={p.id} />
                          <SubmitButton className="btn btn-sm btn-danger">빼기</SubmitButton>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={cols} className="text-center text-muted py-6">
                      기간 안에 완료된 시공 건이 없습니다.{lineEditable && " 오른쪽에서 줄을 더하거나 정산서를 지우세요."}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={cols}>
                    {lines.length}줄 · 합계 {won(p.gross)}원{lineEditable ? " · 뺀 시공 줄은 다음 정산서를 만들 때 다시 모입니다" : ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {editable && (
          <div className="grid gap-4">
            {isDraft ? (
              <>
                <ActionForm action={addPayoutLine} className="card p-4">
                  <h2 className="text-sm font-semibold mb-1">줄 더하기</h2>
                  <p className="text-xs text-muted mb-3">일당·추가 지급·공제. 공제는 음수로 잡히고 합계는 자동으로 다시 계산됩니다.</p>
                  <input type="hidden" name="payout_id" value={p.id} />
                  <div className="grid grid-cols-2 gap-x-2">
                    <div className="form-row">
                      <label className="label" htmlFor="pl-kind">구분</label>
                      <select id="pl-kind" name="kind" defaultValue="extra" className="field">
                        <option value="daily">일당</option>
                        <option value="extra">추가</option>
                        <option value="deduct">공제</option>
                      </select>
                    </div>
                    <div className="form-row">
                      <label className="label" htmlFor="pl-amount">금액<span className="req">*</span></label>
                      <input id="pl-amount" name="amount" required inputMode="numeric" placeholder="50,000" className="field num" />
                    </div>
                  </div>
                  <div className="form-row">
                    <label className="label" htmlFor="pl-date">일자</label>
                    <input id="pl-date" name="work_on" type="date" className="field mono" />
                  </div>
                  <div className="form-row">
                    <label className="label" htmlFor="pl-memo">메모</label>
                    <input id="pl-memo" name="memo" maxLength={200} placeholder="예: 추가 인력 1일" className="field" />
                  </div>
                  <SubmitButton className="btn">더하기</SubmitButton>
                </ActionForm>

                <ActionForm action={setPayoutStatus} className="card p-4">
                  <h2 className="text-sm font-semibold mb-1">확정</h2>
                  <p className="text-xs text-muted mb-3">확정하면 줄을 바꿀 수 없습니다. 작성 중으로 되돌릴 수는 있지만, 지급 뒤에는 되돌리지 못합니다.</p>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="status" value="confirmed" />
                  <div className="form-row">
                    <label className="label" htmlFor="po-memo">메모</label>
                    <input id="po-memo" name="memo" defaultValue={p.memo ?? ""} maxLength={500} className="field" />
                  </div>
                  <SubmitButton>정산서 확정</SubmitButton>
                </ActionForm>

                <details className="card p-4">
                  <summary className="cursor-pointer text-danger text-sm">정산서 지우기</summary>
                  <ActionForm action={deletePayout} className="mt-3">
                    <p className="text-xs text-muted mb-2">줄 {lines.length}개가 함께 지워집니다. 시공 줄은 다음에 정산서를 만들 때 다시 모입니다.</p>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="btn btn-sm btn-danger">지우기</SubmitButton>
                  </ActionForm>
                </details>
              </>
            ) : (
              <>
                <ActionForm action={setPayoutStatus} className="card p-4">
                  <h2 className="text-sm font-semibold mb-1">지급 완료</h2>
                  <p className="text-xs text-muted mb-3">실지급액 {won(p.net)}원을 보낸 뒤 기록합니다. 기록 뒤에는 바꿀 수 없습니다.</p>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="status" value="paid" />
                  <div className="form-row">
                    <label className="label" htmlFor="po-pay">지급 수단</label>
                    <select id="po-pay" name="pay_method_code" defaultValue={defaultPay} className="field">
                      <option value="">—</option>
                      {payMethods.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <label className="label" htmlFor="po-memo-paid">메모</label>
                    <input id="po-memo-paid" name="memo" defaultValue={p.memo ?? ""} maxLength={500} className="field" />
                  </div>
                  <SubmitButton>지급 완료로 기록</SubmitButton>
                </ActionForm>

                <ActionForm action={setPayoutStatus} className="card p-4">
                  <p className="text-xs text-muted mb-2">줄을 고쳐야 하면 작성 중으로 되돌립니다.</p>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="status" value="draft" />
                  <SubmitButton className="btn btn-sm">작성 중으로 되돌리기</SubmitButton>
                </ActionForm>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
