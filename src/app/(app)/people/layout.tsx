import { requireTenant } from "@/lib/auth/session";
import { visible } from "@/lib/nav";
import { SubTabs } from "@/components/sub-tabs";
import { PEOPLE_TABS } from "./tabs";

export default async function PeopleLayout({ children }: LayoutProps<"/people">) {
  const session = await requireTenant();
  const tabs = visible(PEOPLE_TABS, session.can);
  return (
    <div>
      <div className="panel-head">
        <h1>
          사람 <span className="sub">{session.current.tenant.name}</span>
        </h1>
      </div>
      {tabs.length > 0 ? (
        <>
          <SubTabs tabs={tabs} />
          <div className="p-4">{children}</div>
        </>
      ) : (
        <p className="p-4 text-sm text-muted">고객·시공자·협력업체를 볼 수 있는 권한이 없습니다.</p>
      )}
    </div>
  );
}
