"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 px-4 border-b border-border bg-surface overflow-x-auto">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "px-3 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px " +
              (active ? "border-accent text-accent font-semibold" : "border-transparent text-muted")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
