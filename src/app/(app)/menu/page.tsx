import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { NAV, visible } from "@/lib/nav";
import { Icon } from "@/components/icons";

export const metadata = { title: "메뉴" };

export default async function MenuPage() {
  const session = await requireTenant();
  const groups = NAV.map((g) => ({ ...g, items: visible(g.items, session.can) })).filter((g) => g.items.length > 0);
  return (
    <div>
      <div className="panel-head"><h1>전체 메뉴</h1></div>
      <div className="p-4 grid gap-3 max-w-[640px]">
        {groups.map((g, i) => (
          <div key={i} className="card">
            {g.title && <div className="px-4 pt-3 pb-1 text-[11.5px] text-muted">{g.title}</div>}
            {g.items.map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center gap-3 px-4 py-3 border-t border-border text-[15px] text-text no-underline first:border-t-0">
                <Icon name={item.icon} size={18} className="text-muted" />
                <span className="flex-1">{item.label}</span>
                {item.day && <span className="text-[11px] text-muted mono">D{item.day}</span>}
              </Link>
            ))}
          </div>
        ))}
        <div className="text-xs text-muted px-1">
          {session.profile?.display_name || session.user.email} · {session.current.role.name}
        </div>
      </div>
    </div>
  );
}
