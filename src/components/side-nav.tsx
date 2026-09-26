"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import type { NavGroup, NavItem } from "@/lib/nav";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 overflow-y-auto py-2">
      {groups.map((g, gi) => (
        <div key={gi} className="mb-2">
          {g.title && <div className="px-[17px] pt-2 pb-1 text-[10.5px] text-muted">{g.title}</div>}
          {g.items.map((item) => {
            // 하위 경로가 더 구체적인 항목(계약 등록)에 잡히면 상위(계약 목록)는 비활성
            const active =
              isActive(pathname, item.href) &&
              !g.items.some((o) => o !== item && o.href.length > item.href.length && isActive(pathname, o.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "flex items-center gap-2 py-2 pr-3.5 text-[13px] leading-none " +
                  (active
                    ? "pl-[14px] border-l-[3px] border-accent bg-accent-bg text-accent font-semibold"
                    : "pl-[17px] text-muted hover:text-text")
                }
              >
                <Icon name={item.icon} size={15} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function MobileTabs({ tabs }: { tabs: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-20 grid border-t border-border bg-surface"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)`, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((t) => {
        const active = isActive(pathname, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "flex flex-col items-center gap-1 pt-[9px] pb-[11px] text-[11.5px] " +
              (active ? "text-accent font-bold" : "text-muted")
            }
          >
            <Icon name={t.icon} size={18} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
