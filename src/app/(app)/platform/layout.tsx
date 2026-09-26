import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { platformContext } from "@/lib/market";
import { SubTabs } from "@/components/sub-tabs";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { claimOperator } from "@/lib/actions/platform";
import { pendingCounts } from "./data";

/** 플랫폼 운영: 운영사 사업체로 접속한 platform.manage 권한자만. 운영사가 아직 없으면 대표가 지정할 수 있다. 그 외에는 404. */
export default async function PlatformLayout({ children }: LayoutProps<"/platform">) {
  const session = await requireTenant();
  const supabase = await createClient();
  const platform = await platformContext(supabase, session.current.tenant_id, session.can);

  if (!platform.isPlatformAdmin) {
    if (platform.operatorTenantId === null && session.current.role.code === "owner") {
      return (
        <div className="p-4 max-w-[560px]">
          <div className="card p-5">
            <h1 className="text-base font-semibold mb-2">집대리 운영사 지정</h1>
            <p className="text-sm text-muted mb-2">
              아직 집대리 플랫폼 운영사가 지정되지 않았습니다. 운영사는 협력업체 신청 심사, 업체 노출, 수수료·정산, 광고 승인을 맡는 사업체이며 한 번만 정할 수
              있습니다.
            </p>
            <p className="text-sm text-muted mb-4">
              운영사로 지정하면 이 사업체의 대표(및 <span className="mono text-xs">platform.manage</span> 권한을 가진 역할)에게 &lsquo;플랫폼 운영&rsquo; 메뉴가
              열립니다. 협력업체 사업체는 승인할 때 따로 만들어지므로, 운영사 사업체는 시공 업무용 사업체와 분리해 두는 편이 좋습니다.
            </p>
            <ActionForm action={claimOperator}>
              <SubmitButton className="btn btn-primary" pendingText="지정하는 중…">
                이 사업체({session.current.tenant.name})를 집대리 운영사로 지정
              </SubmitButton>
            </ActionForm>
          </div>
        </div>
      );
    }
    notFound();
  }

  const counts = await pendingCounts(supabase);
  const tabs = [
    { href: "/platform", label: "현황" },
    { href: "/platform/applications", label: "신청 심사", count: counts.applications > 0 ? counts.applications : undefined },
    { href: "/platform/vendors", label: "업체·수수료" },
    { href: "/platform/requests", label: "요청·견적" },
    { href: "/platform/settlements", label: "정산" },
    { href: "/platform/promotions", label: "광고", count: counts.promotions > 0 ? counts.promotions : undefined },
    { href: "/platform/categories", label: "분류" },
  ];
  return (
    <div>
      <div className="panel-head">
        <h1>
          집대리 플랫폼 운영 <span className="sub">{platform.platformName} · {session.current.tenant.name}</span>
        </h1>
      </div>
      <SubTabs tabs={tabs} />
      {children}
    </div>
  );
}
