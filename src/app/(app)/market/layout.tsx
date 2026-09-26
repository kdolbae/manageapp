import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SubTabs } from "@/components/sub-tabs";
import { myVendorProfile, openRequestCount } from "./data";

/** 집대리 마켓(협력업체 쪽) 하위 탭. 요청·견적·업체 소개·정산·상단 노출. */
export default async function MarketLayout({ children }: LayoutProps<"/market">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const head = (
    <div className="panel-head">
      <h1>
        집대리 마켓 <span className="sub">{session.current.tenant.name}</span>
      </h1>
    </div>
  );
  if (!session.can("market.read")) {
    return (
      <div>
        {head}
        <p className="p-4 text-sm text-muted">집대리 마켓(요청·견적)을 볼 수 있는 권한이 없습니다.</p>
      </div>
    );
  }
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [profile, open] = await Promise.all([myVendorProfile(supabase, tid), openRequestCount(supabase, now)]);
  const tabs = [
    { href: "/market", label: "요청", count: open > 0 ? open : undefined },
    { href: "/market/quotes", label: "내 견적" },
    { href: "/market/profile", label: "업체 소개" },
    ...(session.can("market.settle") ? [{ href: "/market/settlements", label: "정산" }] : []),
    { href: "/market/promotions", label: "상단 노출" },
  ];
  return (
    <div>
      <div className="panel-head">
        <h1>
          집대리 마켓 <span className="sub">{session.current.tenant.name}</span>
        </h1>
        {profile && (profile.is_listed ? <span className="badge badge-done">노출 중</span> : <span className="badge badge-wait">노출 대기</span>)}
      </div>
      <SubTabs tabs={tabs} />
      {!profile && (
        <div className="px-4 pt-4">
          <p className="notice">
            업체 소개를 등록하고 집대리 운영자가 노출을 켜면 견적 요청이 옵니다. <Link href="/market/profile">업체 소개 등록 →</Link>
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
