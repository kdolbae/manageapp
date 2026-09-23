import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { todayKST, mmdd } from "@/lib/dates";
import { monthEnd, sum } from "@/lib/stats";
import { codeValues, labelOf } from "@/lib/codes";
import { fmtDateTime } from "@/lib/inbox";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createExpense, updateExpense, decideExpense, deleteExpense } from "@/lib/actions/finance";
import { branchOptions } from "@/app/(app)/people/data";
import { EXPENSE_STATUS, isValidMonth, addMonths, monthLabel } from "@/lib/finance";

export const metadata = { title: "경비" };

type ExpenseRow = {
  id: string;
  branch_id: string | null;
  category_code: string;
  amount: number;
  vat: number;
  occurred_on: string;
  vendor: string | null;
  memo: string | null;
  pay_method_code: string | null;
  contract_id: string | null;
  status: string;
  reject_reason: string | null;
  created_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  creator: { display_name: string } | null;
  approver: { display_name: string } | null;
};

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "submitted", label: "청구됨" },
  { key: "approved", label: "승인" },
  { key: "paid", label: "지급" },
  { key: "rejected", label: "반려" },
  { key: "mine", label: "내 청구" },
];
const EDITABLE = ["draft", "submitted", "rejected"];

export default async function ExpensesPage({ searchParams }: PageProps<"/finance/expenses">) {
  const session = await requireTenant();
  const canWrite = session.can("expense.write");
  const canApprove = session.can("expense.approve");
  if (!canWrite && !canApprove && !session.can("finance.read")) return <p className="p-4 text-sm text-muted">경비를 볼 수 있는 권한이 없습니다.</p>;
  const sp = await searchParams;
  const today = todayKST();
  const thisMonth = today.slice(0, 7);
  const m = sp.m === "all" ? "all" : isValidMonth(sp.m) ? sp.m : thisMonth;
  const s = typeof sp.s === "string" && FILTERS.some((f) => f.key === sp.s) ? sp.s : "all";
  const tid = session.current.tenant_id;
  const me = session.user.id;
  const supabase = await createClient();

  let q = supabase
    .from("expense")
    .select(
      "id, branch_id, category_code, amount, vat, occurred_on, vendor, memo, pay_method_code, contract_id, status, reject_reason, created_by, approved_at, paid_at, created_at, " +
        "creator:profile!expense_created_by_fkey(display_name), approver:profile!expense_approved_by_fkey(display_name)",
    )
    .eq("tenant_id", tid)
    .is("deleted_at", null);
  if (m !== "all") q = q.gte("occurred_on", `${m}-01`).lte("occurred_on", monthEnd(`${m}-01`));
  const [{ data: rows }, categories, payMethods, branches] = await Promise.all([
    q.order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    codeValues(tid, "expense_category"),
    codeValues(tid, "pay_method"),
    branchOptions(supabase, tid),
  ]);
  const all = (rows ?? []) as unknown as ExpenseRow[];
  const matches = (e: ExpenseRow, key: string) => (key === "all" ? true : key === "mine" ? e.created_by === me : e.status === key);
  const list = all.filter((e) => matches(e, s));
  const countOf = (key: string) => all.filter((e) => matches(e, key)).length;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const showBranch = branches.length > 1;
  const base = m === "all" ? thisMonth : m;
  const qs = (patch: { m?: string; s?: string }) => `/finance/expenses?m=${patch.m ?? m}&s=${patch.s ?? s}`;
  const total = sum(list, (e) => e.amount);
  const vatTotal = sum(list, (e) => e.vat);
  const pendingCount = countOf("submitted");
  const editable = (e: ExpenseRow) => e.created_by === me && EDITABLE.includes(e.status);
  const cols = showBranch ? 8 : 7;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        {FILTERS.map((f) => (
          <Link key={f.key} href={qs({ s: f.key })} className={`chip ${s === f.key ? "is-active" : ""}`}>
            {f.label}
            <span className="mono text-[11px] text-muted">{countOf(f.key)}</span>
          </Link>
        ))}
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          <Link href={qs({ m: addMonths(base, -1) })} className="btn btn-sm">이전 달</Link>
          <span className="text-sm font-semibold px-1">{m === "all" ? "전체 기간" : monthLabel(m)}</span>
          <Link href={qs({ m: addMonths(base, 1) })} className="btn btn-sm">다음 달</Link>
          {m !== thisMonth && <Link href={qs({ m: thisMonth })} className="chip">이번 달</Link>}
          {m !== "all" && <Link href={qs({ m: "all" })} className="chip">전체 기간</Link>}
        </div>
      </div>

      <div className={"grid gap-4 p-4 items-start" + (canWrite ? " lg:grid-cols-[1fr_340px]" : "")}>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>일자</th>
                <th>분류</th>
                <th>거래처 · 내용</th>
                <th className="text-right">금액</th>
                <th>청구자</th>
                {showBranch && <th>지점</th>}
                <th>상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => {
                const st = EXPENSE_STATUS[e.status] ?? { label: e.status, badge: "wait" as const };
                const mine = editable(e);
                const decidable = canApprove && e.status !== "paid";
                const removable = mine || canApprove;
                return (
                  <tr key={e.id}>
                    <td className="mono text-xs">{mmdd(e.occurred_on)}</td>
                    <td>{labelOf(categories, e.category_code) || e.category_code}</td>
                    <td>
                      {e.vendor && <span className="font-medium">{e.vendor}</span>}
                      {e.memo && <div className="text-xs text-muted">{e.memo}</div>}
                      {e.pay_method_code && <div className="text-[11px] text-muted">{labelOf(payMethods, e.pay_method_code)}</div>}
                      {!e.vendor && !e.memo && !e.pay_method_code && <span className="zero">—</span>}
                    </td>
                    <td className="num">
                      {won(e.amount)}
                      {Number(e.vat) > 0 && <div className="text-[11px] text-muted font-normal">부가세 {won(e.vat)}</div>}
                    </td>
                    <td className="text-xs">{e.creator?.display_name ?? "—"}</td>
                    {showBranch && <td className="text-xs">{e.branch_id ? (branchName.get(e.branch_id) ?? "—") : "본사 공통"}</td>}
                    <td>
                      <span className={`badge badge-${st.badge}`}>{st.label}</span>
                      {e.status === "rejected" && e.reject_reason && <div className="text-[11px] text-danger mt-1 max-w-[200px]">{e.reject_reason}</div>}
                      {(e.status === "approved" || e.status === "paid") && e.approver && (
                        <div className="text-[11px] text-muted mt-1">
                          {e.approver.display_name}
                          {e.status === "paid" && e.paid_at ? ` · 지급 ${fmtDateTime(e.paid_at)}` : e.approved_at ? ` · ${fmtDateTime(e.approved_at)}` : ""}
                        </div>
                      )}
                    </td>
                    <td>
                      {decidable || removable ? (
                        <details>
                          <summary className="cursor-pointer text-accent text-xs whitespace-nowrap">{decidable ? "결재" : mine ? "수정" : "관리"}</summary>
                          <div className="mt-2 grid gap-3 min-w-[260px]">
                            {decidable && (
                              <ActionForm action={decideExpense} className="grid gap-2">
                                <input type="hidden" name="id" value={e.id} />
                                {e.status !== "rejected" && <input name="reject_reason" maxLength={300} placeholder="반려 사유 (반려할 때만)" className="field h-8 text-xs" />}
                                <div className="flex flex-wrap gap-1.5">
                                  {e.status !== "approved" && <button name="status" value="approved" className="btn btn-sm btn-primary">승인</button>}
                                  {e.status === "approved" && <button name="status" value="paid" className="btn btn-sm btn-primary">지급</button>}
                                  {e.status !== "rejected" && <button name="status" value="rejected" className="btn btn-sm btn-danger">반려</button>}
                                </div>
                              </ActionForm>
                            )}
                            {mine && (
                              <ActionForm action={updateExpense} className={"grid gap-2" + (decidable ? " border-t border-border pt-3" : "")}>
                                <input type="hidden" name="id" value={e.id} />
                                <select name="category_code" defaultValue={e.category_code} aria-label="분류" className="field h-8 text-xs">
                                  {!categories.some((c) => c.code === e.category_code) && <option value={e.category_code}>{e.category_code}</option>}
                                  {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                                </select>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <input name="amount" defaultValue={won(e.amount)} required inputMode="numeric" aria-label="금액" placeholder="금액" className="field h-8 text-xs num" />
                                  <input name="vat" defaultValue={Number(e.vat) > 0 ? won(e.vat) : ""} inputMode="numeric" aria-label="부가세" placeholder="부가세" className="field h-8 text-xs num" />
                                </div>
                                <input name="occurred_on" type="date" defaultValue={e.occurred_on} required aria-label="발생일" className="field h-8 text-xs mono" />
                                <input name="vendor" defaultValue={e.vendor ?? ""} maxLength={80} placeholder="거래처" className="field h-8 text-xs" />
                                <input name="memo" defaultValue={e.memo ?? ""} maxLength={500} placeholder="내용" className="field h-8 text-xs" />
                                <select name="pay_method_code" defaultValue={e.pay_method_code ?? ""} aria-label="결제수단" className="field h-8 text-xs">
                                  <option value="">결제수단 없음</option>
                                  {payMethods.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                                </select>
                                <div className="flex flex-wrap gap-1.5">
                                  <SubmitButton className="btn btn-sm">저장</SubmitButton>
                                  {e.status === "rejected" && <button name="status" value="submitted" className="btn btn-sm btn-primary">고쳐서 다시 청구</button>}
                                </div>
                              </ActionForm>
                            )}
                            {removable && (
                              <details>
                                <summary className="cursor-pointer text-danger text-xs">이 경비 지우기</summary>
                                <ActionForm action={deleteExpense} className="mt-2 flex items-center gap-2">
                                  <input type="hidden" name="id" value={e.id} />
                                  <SubmitButton className="btn btn-sm btn-danger">지우기</SubmitButton>
                                  <span className="text-xs text-muted">목록과 손익에서 빠집니다.</span>
                                </ActionForm>
                              </details>
                            )}
                          </div>
                        </details>
                      ) : (
                        <span className="zero">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={cols} className="text-center text-muted py-6">
                    {m === "all" ? "" : `${monthLabel(m)}에 `}해당하는 경비가 없습니다.{canWrite && " 오른쪽에서 청구합니다."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={cols}>
                  {list.length}건 · 합계 {won(total)}원{vatTotal ? ` (부가세 ${won(vatTotal)}원 포함)` : ""}
                  {canApprove && pendingCount ? ` · 결재 대기 ${pendingCount}건` : ""}
                  {all.length >= 500 ? " · 최근 500건까지만 보입니다" : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {canWrite && (
          <ActionForm action={createExpense} className="card p-4">
            <h2 className="text-sm font-semibold mb-1">경비 청구</h2>
            <p className="text-xs text-muted mb-3">영수증 금액(부가세 포함)으로 적습니다. 결재자가 승인·지급하면 손익에 반영됩니다.</p>
            <div className="form-row">
              <label className="label" htmlFor="ex-cat">분류<span className="req">*</span></label>
              <select id="ex-cat" name="category_code" required className="field">
                {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              {categories.length === 0 && <p className="text-xs text-danger mt-1">경비 분류 코드값(expense_category)이 없습니다. 설정에서 추가해 주세요.</p>}
            </div>
            <div className="grid grid-cols-2 gap-x-2">
              <div className="form-row">
                <label className="label" htmlFor="ex-amount">금액<span className="req">*</span></label>
                <input id="ex-amount" name="amount" required inputMode="numeric" placeholder="120,000" className="field num" />
              </div>
              <div className="form-row">
                <label className="label" htmlFor="ex-date">발생일<span className="req">*</span></label>
                <input id="ex-date" name="occurred_on" type="date" required defaultValue={today} className="field mono" />
              </div>
            </div>
            <label className="form-row flex items-center gap-2 text-sm">
              <input type="checkbox" name="vat_included" />
              부가세 포함 10% (부가세 = 금액/11)
            </label>
            <div className="form-row">
              <label className="label" htmlFor="ex-vendor">거래처</label>
              <input id="ex-vendor" name="vendor" maxLength={80} placeholder="예: 주유소, 자재상" className="field" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="ex-memo">내용</label>
              <input id="ex-memo" name="memo" maxLength={500} className="field" />
            </div>
            <div className="grid grid-cols-2 gap-x-2">
              <div className="form-row">
                <label className="label" htmlFor="ex-pay">결제수단</label>
                <select id="ex-pay" name="pay_method_code" defaultValue="" className="field">
                  <option value="">—</option>
                  {payMethods.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                </select>
              </div>
              {showBranch && (
                <div className="form-row">
                  <label className="label" htmlFor="ex-branch">지점</label>
                  <select id="ex-branch" name="branch_id" defaultValue={session.current.branch_id ?? ""} className="field">
                    <option value="">본사 공통</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <SubmitButton>청구</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
