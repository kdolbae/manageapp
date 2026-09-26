import { requireTenant } from "@/lib/auth/session";
import { SubTabs } from "@/components/sub-tabs";

export default async function InventoryLayout({ children }: LayoutProps<"/inventory">) {
  const session = await requireTenant();
  const can = session.can;
  // 본인 범위(시공기사) 계정은 RLS 상 출고·이동(본인 차량)만 기록할 수 있어 입고 탭을 숨긴다.
  const own = session.current.scope === "own";
  const tabs = [
    can("inventory.read") ? { href: "/inventory", label: "재고 현황" } : null,
    can("inventory.move") ? { href: "/inventory/out", label: "출고" } : null,
    can("inventory.move") && !own ? { href: "/inventory/in", label: "입고" } : null,
    can("inventory.read") ? { href: "/inventory/moves", label: "내역" } : null,
    can("inventory.read") ? { href: "/inventory/items", label: "품목·단가" } : null,
    can("inventory.price") ? { href: "/inventory/warehouses", label: "창고" } : null,
  ].filter((t): t is { href: string; label: string } => t !== null);

  return (
    <div>
      <div className="panel-head">
        <h1>
          자재·창고 <span className="sub">{session.current.tenant.name}</span>
        </h1>
      </div>
      {tabs.length > 0 ? (
        <>
          <SubTabs tabs={tabs} />
          {children}
        </>
      ) : (
        <p className="p-4 text-sm text-muted">자재·창고를 볼 수 있는 권한이 없습니다.</p>
      )}
    </div>
  );
}
