import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { NAV, MOBILE_TABS, visible } from "@/lib/nav";
import { SideNav, MobileTabs } from "@/components/side-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { NotificationBell, type Notice } from "@/components/notification-bell";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { platformContext } from "@/lib/market";

// 로그인·사업체 컨텍스트가 필요하므로 항상 요청 시점에 렌더링한다.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireTenant();
  const supabase = await createClient();
  const platform = await platformContext(supabase, session.current.tenant_id, session.can);
  // 플랫폼 운영 메뉴는 운영사 사업체로 접속한 운영자에게만
  const can = (p: string) => (p === "platform.manage" ? platform.isPlatformAdmin : session.can(p));
  const groups = NAV.map((g) => ({ ...g, items: visible(g.items, can) })).filter((g) => g.items.length > 0);
  const tabs = visible(MOBILE_TABS, can);
  const tenants = session.memberships.map((m) => ({ id: m.tenant_id, name: m.tenant.name }));
  const name = session.profile?.display_name || session.user.email || "";
  const roleName = session.current.role.name;
  const { data: notices } = await supabase.from("inapp_notification").select("id, kind, title, body, link, created_at, read_at").eq("profile_id", session.user.id).order("created_at", { ascending: false }).limit(20);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[150px_minmax(0,1fr)]">
      <aside className="hidden md:flex flex-col border-r border-border bg-bg sticky top-0 h-dvh">
        <Link href="/" className="block px-[17px] pt-4 pb-3 border-b border-border text-text no-underline">
          <div className="text-[15px] font-bold leading-tight truncate">{session.current.tenant.name}</div>
          <div className="text-[10.5px] text-muted mt-0.5">집대리</div>
        </Link>
        <SideNav groups={groups} />
        <div className="px-[17px] py-3 border-t border-border text-[11.5px] text-muted">
          <div className="truncate text-text font-medium">{name}</div>
          <div>{roleName}</div>
        </div>
      </aside>

      <div className="flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-3 h-[45px] px-3 md:px-4 border-b border-border bg-surface sticky top-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <TenantSwitcher tenants={tenants} currentId={session.current.tenant_id} />
            {session.current.branch && <span className="badge badge-wait">{session.current.branch.name}</span>}
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell initial={(notices ?? []) as Notice[]} userId={session.user.id} realtime={supabaseEnv().configured} />
            <ThemeToggle />
            <span className="hidden sm:inline text-xs text-muted truncate max-w-[160px]">{name}</span>
            <form action="/auth/signout" method="post">
              <button className="btn btn-sm">로그아웃</button>
            </form>
          </div>
        </header>
        <main className="flex-1 pb-[70px] md:pb-0">{children}</main>
      </div>

      <MobileTabs tabs={tabs} />
    </div>
  );
}
