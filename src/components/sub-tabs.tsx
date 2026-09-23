"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 화면 상단의 하위 탭 (설정, 사람, 상품 등에서 공용). */
export function SubTabs({ tabs }: { tabs: { href: string; label: string; count?: number }[] }) {
  const pathname = usePathname();
  // 하위 경로가 겹치는 탭(/products 와 /products/categories)은 가장 긴 것 하나만 활성.
  const current = tabs.filter((t) => pathname === t.href || pathname.startsWith(t.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="flex gap-1 px-4 border-b border-border bg-surface overflow-x-auto">
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "px-3 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px flex items-center gap-1.5 " +
              (active ? "border-accent text-accent font-semibold" : "border-transparent text-muted")
            }
          >
            {t.label}
            {typeof t.count === "number" && <span className="mono text-[11px] text-muted">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
