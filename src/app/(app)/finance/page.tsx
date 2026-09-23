import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { todayKST } from "@/lib/dates";
import { monthEnd, sum, groupBy, pctText, deltaText } from "@/lib/stats";
import { codeValues, labelOf } from "@/lib/codes";
import { Bars } from "@/components/bars";
import { branchOptions } from "@/app/(app)/people/data";
import { isValidMonth, addMonths, monthLabel } from "@/lib/finance";

export const metadata = { title: "월 손익" };

type ContractRow = { id: string; branch_id: string | null; contract_date: string; sale_total: number; paid_total: number; balance: number };
type LineRow = { contract_id: string; technician_rate: number; contract: { contract_date: string; branch_id: string | null; canceled_at: string | null; approval_status: string } };
type ExpenseRow = { id: string; branch_id: string | null; category_code: string; amount: number; occurred_on: string };

function numbers(cs: ContractRow[], ls: LineRow[], es: ExpenseRow[]) {
  const sales = sum(cs, (c) => c.sale_total);
  const labor = sum(ls, (l) => l.technician_rate);
  const expense = sum(es, (e) => e.amount);
  return { count: cs.length, sales, labor, expense, profit: sales - labor - expense, paid: sum(cs, (c) => c.paid_total), balance: sum(cs, (c) => c.balance) };
}

export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const session = await requireTenant();
  if (!session.can("finance.read")) {
    if (session.can("expense.write") || session.can("expense.approve")) redirect("/finance/expenses");
    if (session.can("payout.read") || session.can("payout.approve") || session.current.role.code === "technician") redirect("/finance/payouts");
    return <p className="p-4 text-sm text-muted">재무 현황을 볼 수 있는 권한이 없습니다.</p>;
  }
  const sp = await searchParams;
  const today = todayKST();
  const thisMonth = today.slice(0, 7);
  const ym = isValidMonth(sp.m) ? sp.m : thisMonth;
  const to = monthEnd(`${ym}-01`);
  const winFrom = `${addMonths(ym, -11)}-01`; // 12개월 창(직전 달 비교도 이 안에서)
  const tid = session.current.tenant_id;
  const supabase = await createClient();

  const [{ data: cRows }, { data: lRows }, { data: eRows }, categories, branches] = await Promise.all([
    supabase.from("contract_summary").select("id, branch_id, contract_date, sale_total, paid_total, balance").eq("tenant_id", tid).is("canceled_at", null).neq("approval_status", "rejected").gte("contract_date", winFrom).lte("contract_date", to),
    supabase.from("contract_line").select("contract_id, technician_rate, contract!inner(contract_date, branch_id, canceled_at, approval_status)").eq("tenant_id", tid).is("contract.canceled_at", null).neq("contract.approval_status", "rejected").gte("contract.contract_date", winFrom).lte("contract.contract_date", to),
    supabase.from("expense").select("id, branch_id, category_code, amount, occurred_on").eq("tenant_id", tid).is("deleted_at", null).in("status", ["approved", "paid"]).gte("occurred_on", winFrom).lte("occurred_on", to),
    codeValues(tid, "expense_category"),
    branchOptions(supabase, tid),
  ]);
  const contracts = (cRows ?? []) as ContractRow[];
  const lines = ((lRows ?? []) as unknown as LineRow[]).filter((l) => l.contract && !l.contract.canceled_at && l.contract.approval_status !== "rejected");
  const expenses = (eRows ?? []) as ExpenseRow[];
  const inMonth = (ymd: string, m: string) => ymd.slice(0, 7) === m;
  const ofMonth = (m: string) => numbers(contracts.filter((c) => inMonth(c.contract_date, m)), lines.filter((l) => inMonth(l.contract.contract_date, m)), expenses.filter((e) => inMonth(e.occurred_on, m)));

  const monthContracts = contracts.filter((c) => inMonth(c.contract_date, ym));
  const monthLines = lines.filter((l) => inMonth(l.contract.contract_date, ym));
  const monthExpenses = expenses.filter((e) => inMonth(e.occurred_on, ym));
  const cur = numbers(monthContracts, monthLines, monthExpenses);
  const prev = ofMonth(addMonths(ym, -1));
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(ym, i - 11);
    return { m, ...ofMonth(m) };
  });
  const yearTotal = numbers(contracts, lines, expenses);
  // 직전 달이 적자면 증감률이 뒤집혀 보이므로 표시하지 않는다.
  const delta = (now: number, before: number) => (before < 0 ? "—" : deltaText(now, before));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const branchKeys = [...new Set([...monthContracts.map((c) => c.branch_id ?? ""), ...monthLines.map((l) => l.contract.branch_id ?? ""), ...monthExpenses.map((e) => e.branch_id ?? "")])];
  const byBranch = branchKeys
    .map((k) => ({
      key: k || "hq",
      name: k ? (branchName.get(k) ?? "—") : "본사 공통",
      ...numbers(monthContracts.filter((c) => (c.branch_id ?? "") === k), monthLines.filter((l) => (l.contract.branch_id ?? "") === k), monthExpenses.filter((e) => (e.branch_id ?? "") === k)),
    }))
    .sort((a, b) => b.sales - a.sales);
  const zeroOr = (v: number, cls = "") => (v ? <span className={cls}>{won(v)}</span> : <span className="zero">0</span>);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        <Link href={`/finance?m=${addMonths(ym, -1)}`} className="btn btn-sm">이전 달</Link>
        <span className="text-sm font-semibold px-1">{monthLabel(ym)}</span>
        <Link href={`/finance?m=${addMonths(ym, 1)}`} className="btn btn-sm">다음 달</Link>
        {ym !== thisMonth && <Link href="/finance" className="chip">이번 달</Link>}
        <form method="get" className="flex items-center gap-1.5 ml-auto">
          <input type="month" name="m" defaultValue={ym} className="field h-8 text-xs w-[150px] mono" />
          <button className="btn btn-sm">보기</button>
        </form>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border-b border-border bg-surface">
        <div className="stat"><div className="k">매출</div><div className={`v ${cur.sales ? "" : "zero"}`}>{won(cur.sales)}<span className="text-xs text-muted font-normal ml-1">원 · {cur.count}건 · 직전 {delta(cur.sales, prev.sales)}</span></div></div>
        <div className="stat"><div className="k">기사비</div><div className={`v ${cur.labor ? "" : "zero"}`}>{won(cur.labor)}<span className="text-xs text-muted font-normal ml-1">원 · 매출의 {pctText(cur.labor, cur.sales)} · 직전 {delta(cur.labor, prev.labor)}</span></div></div>
        <div className="stat"><div className="k">경비</div><div className={`v ${cur.expense ? "" : "zero"}`}>{won(cur.expense)}<span className="text-xs text-muted font-normal ml-1">원 · {monthExpenses.length}건 · 직전 {delta(cur.expense, prev.expense)}</span></div></div>
        <div className="stat"><div className="k">영업이익</div><div className={`v ${cur.profit < 0 ? "text-danger" : cur.profit ? "text-success" : "zero"}`}>{won(cur.profit)}<span className="text-xs text-muted font-normal ml-1">원 · 이익률 {pctText(cur.profit, cur.sales)} · 직전 {delta(cur.profit, prev.profit)}</span></div></div>
        <div className="stat"><div className="k">수납</div><div className={`v ${cur.paid ? "" : "zero"}`}>{won(cur.paid)}<span className="text-xs text-muted font-normal ml-1">원 · 수납률 {pctText(cur.paid, cur.sales)}</span></div></div>
        <div className="stat"><div className="k">미수</div><div className={`v ${cur.balance > 0 ? "text-warn" : "zero"}`}>{won(cur.balance)}<span className="text-xs text-muted font-normal ml-1">원 · 직전 {delta(cur.balance, prev.balance)}</span></div></div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2 items-start">
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">경비 분류별</h2>
          <p className="text-xs text-muted mb-3">{monthLabel(ym)}에 발생한 승인·지급 경비. 분류는 사업체 코드값(expense_category)입니다.</p>
          <Bars
            unit="won"
            rows={[...groupBy(monthExpenses, (e) => e.category_code).entries()]
              .map(([k, list]) => ({ key: k || "-", label: labelOf(categories, k) || k || "미분류", value: sum(list, (e) => e.amount), sub: `${list.length}건` }))
              .sort((a, b) => b.value - a.value)}
            empty="이 달에 승인·지급된 경비가 없습니다."
          />
          <div className="mt-3 text-right"><Link href={`/finance/expenses?m=${ym}`} className="btn btn-sm">경비 목록</Link></div>
        </div>

        <div className="card overflow-x-auto">
          <div className="panel-head"><h2>12개월 추이 <span className="sub">{months[0].m} ~ {ym}</span></h2></div>
          <table className="tbl">
            <thead><tr><th>월</th><th className="text-right">매출</th><th className="text-right">기사비</th><th className="text-right">경비</th><th className="text-right">이익</th><th className="text-right">이익률</th></tr></thead>
            <tbody>
              {months.map((r) => (
                <tr key={r.m} className={r.m === ym ? "is-selected font-semibold" : ""}>
                  <td className="mono text-xs"><Link href={`/finance?m=${r.m}`}>{r.m}</Link></td>
                  <td className="num">{zeroOr(r.sales)}</td>
                  <td className="num">{zeroOr(r.labor)}</td>
                  <td className="num">{zeroOr(r.expense)}</td>
                  <td className="num">{zeroOr(r.profit, r.profit < 0 ? "text-danger" : "")}</td>
                  <td className="num">{pctText(r.profit, r.sales)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>12개월 합계</td>
                <td className="num">{won(yearTotal.sales)}</td>
                <td className="num">{won(yearTotal.labor)}</td>
                <td className="num">{won(yearTotal.expense)}</td>
                <td className="num">{won(yearTotal.profit)}</td>
                <td className="num">{pctText(yearTotal.profit, yearTotal.sales)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {branches.length > 1 && (
          <div className="card overflow-x-auto">
            <div className="panel-head"><h2>지점별 <span className="sub">{monthLabel(ym)}</span></h2></div>
            <table className="tbl">
              <thead><tr><th>지점</th><th className="text-right">계약</th><th className="text-right">매출</th><th className="text-right">기사비</th><th className="text-right">경비</th><th className="text-right">이익</th><th className="text-right">이익률</th></tr></thead>
              <tbody>
                {byBranch.map((b) => (
                  <tr key={b.key}>
                    <td className="font-medium">{b.name}</td>
                    <td className="num">{b.count}</td>
                    <td className="num">{zeroOr(b.sales)}</td>
                    <td className="num">{zeroOr(b.labor)}</td>
                    <td className="num">{zeroOr(b.expense)}</td>
                    <td className="num">{zeroOr(b.profit, b.profit < 0 ? "text-danger" : "")}</td>
                    <td className="num">{pctText(b.profit, b.sales)}</td>
                  </tr>
                ))}
                {byBranch.length === 0 && <tr><td colSpan={7} className="text-muted">이 달 자료가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">계산 기준</h2>
          <ul className="text-xs text-muted grid gap-1 list-disc pl-4">
            <li>매출: 계약일이 이 달인 계약의 판매금액(품목 합계 + 할인·조정). 취소·반려된 계약은 뺍니다.</li>
            <li>기사비: 그 계약 품목에 기록된 기사 시공비 스냅샷. 실제 지급은 기사 정산에서 관리합니다.</li>
            <li>경비: 발생일이 이 달이고 승인·지급 상태인 경비(부가세 포함 영수증 금액). 청구·반려 상태는 뺍니다.</li>
            <li>영업이익 = 매출 - 기사비 - 경비. 수납·미수는 이 달 계약의 원장 기준입니다.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
