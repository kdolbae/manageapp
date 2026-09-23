import { requireTenant } from "@/lib/auth/session";
import { SubTabs } from "@/components/sub-tabs";

export default async function SalesLayout({ children }: LayoutProps<"/sales">) {
  const session = await requireTenant();
  const tabs = [{ href: "/sales", label: "영업 분석" }, { href: "/sales/campaigns", label: "캠페인·유입 링크" }];
  return (
    <div>
      <div className="panel-head"><h1>영업 <span className="sub">{session.current.tenant.name}</span></h1></div>
      {session.can("report.read") || session.can("content.publish") ? (
        <>
          <SubTabs tabs={tabs} />
          {children}
        </>
      ) : (
        <p className="p-4 text-sm text-muted">영업 분석 권한이 없습니다.</p>
      )}
    </div>
  );
}
