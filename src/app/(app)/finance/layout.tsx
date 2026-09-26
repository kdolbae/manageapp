import { requireTenant } from "@/lib/auth/session";
import { SubTabs } from "@/components/sub-tabs";

/** 경비·정산·재무 하위 탭. 권한(또는 기사 역할)에 따라 보이는 탭만 계산한다. */
export default async function FinanceLayout({ children }: LayoutProps<"/finance">) {
  const session = await requireTenant();
  const can = session.can;
  const isTechnician = session.current.role.code === "technician";
  const tabs: { href: string; label: string }[] = [];
  if (can("finance.read")) tabs.push({ href: "/finance", label: "손익" });
  if (can("expense.write") || can("expense.approve") || can("finance.read")) tabs.push({ href: "/finance/expenses", label: "경비" });
  // 기사 계정은 payout.read 가 없어도 RLS 로 본인 정산서를 본다.
  if (can("payout.read") || can("payout.approve") || isTechnician) tabs.push({ href: "/finance/payouts", label: "기사 정산" });
  return (
    <div>
      <div className="panel-head">
        <h1>
          경비·정산·재무 <span className="sub">{session.current.tenant.name}</span>
        </h1>
      </div>
      {tabs.length > 0 ? (
        <>
          <SubTabs tabs={tabs} />
          {children}
        </>
      ) : (
        <p className="p-4 text-sm text-muted">경비·정산·재무를 볼 수 있는 권한이 없습니다.</p>
      )}
    </div>
  );
}
