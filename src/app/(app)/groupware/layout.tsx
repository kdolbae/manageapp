import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SubTabs } from "@/components/sub-tabs";
import { myPendingDocIds, unreadNoticeCount } from "./data";

export default async function GroupwareLayout({ children }: LayoutProps<"/groupware">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const [unread, pending] = await Promise.all([unreadNoticeCount(supabase, tid, session.user.id), myPendingDocIds(supabase, tid, session.user.id)]);
  const tabs = [
    { href: "/groupware", label: "공지", count: unread > 0 ? unread : undefined },
    { href: "/groupware/org", label: "조직도" },
    { href: "/groupware/approvals", label: "결재", count: pending.length > 0 ? pending.length : undefined },
    { href: "/groupware/leave", label: "휴가" },
  ];
  return (
    <div>
      <div className="panel-head">
        <h1>
          공지·결재·조직 <span className="sub">{session.current.tenant.name}</span>
        </h1>
      </div>
      <SubTabs tabs={tabs} />
      {children}
    </div>
  );
}
