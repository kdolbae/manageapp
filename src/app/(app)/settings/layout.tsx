import { requireTenant } from "@/lib/auth/session";
import { SETTINGS_TABS, visible } from "@/lib/nav";
import { SettingsTabs } from "@/components/settings-tabs";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const session = await requireTenant();
  const tabs = visible(SETTINGS_TABS, session.can);
  return (
    <div>
      <div className="panel-head">
        <h1>
          설정 <span className="sub">{session.current.tenant.name}</span>
        </h1>
      </div>
      {tabs.length > 0 ? (
        <>
          <SettingsTabs tabs={tabs} />
          <div className="p-4">{children}</div>
        </>
      ) : (
        <p className="p-4 text-sm text-muted">설정을 볼 수 있는 권한이 없습니다.</p>
      )}
    </div>
  );
}
