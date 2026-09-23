import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { SubTabs } from "@/components/sub-tabs";

const TABS = [
  { href: "/products", label: "상품" },
  { href: "/products/categories", label: "카테고리" },
];

export default async function ProductsLayout({ children }: LayoutProps<"/products">) {
  const session = await requireTenant();
  return (
    <div>
      <div className="panel-head">
        <h1>
          상품·단가 <span className="sub">{session.current.tenant.name}</span>
        </h1>
        {session.can("product.manage") && (
          <Link href="/products/new" className="btn btn-primary btn-sm h-8 text-[13px]">
            상품 등록
          </Link>
        )}
      </div>
      <SubTabs tabs={TABS} />
      <div className="p-4">{children}</div>
    </div>
  );
}
