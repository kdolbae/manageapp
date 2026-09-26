import Link from "next/link";
import type { ReactNode } from "react";
import { phone } from "@/lib/format";
import { maskName, type Badge } from "@/lib/market";

/* 플랫폼 운영 화면 공용 조각 (서버 컴포넌트) */

/** 목록 위 상태 칩. 현재 값은 ?{param}= 로 받는다. */
export function Chips({
  base,
  param,
  value,
  items,
  children,
}: {
  base: string;
  param: string;
  value: string;
  items: { key: string; label: string; count?: number }[];
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
      {items.map((c) => (
        <Link key={c.key} href={`${base}?${param}=${c.key}`} className={`chip ${value === c.key ? "is-active" : ""}`}>
          {c.label}
          {typeof c.count === "number" && c.count > 0 && <span className="mono text-[11px]">{c.count}</span>}
        </Link>
      ))}
      {children}
    </div>
  );
}

export function StatusBadge({ s, fallback }: { s?: { label: string; badge: Badge }; fallback: string }) {
  const v = s ?? { label: fallback, badge: "wait" as Badge };
  return <span className={`badge badge-${v.badge}`}>{v.label}</span>;
}

/** 010-1234-5678 → 010-****-5678 (뒤 4자리만) */
export function maskPhone(v: string | null | undefined): string {
  const f = phone(v);
  if (!f) return "";
  return f.slice(0, -4).replace(/\d/g, "*") + f.slice(-4);
}

/** 고객 이름·전화는 기본으로 가리고, 펼치면 전체가 보인다 (운영자만 원본 행을 읽는다). */
export function RevealContact({ name, phone: p, email }: { name: string; phone: string; email?: string | null }) {
  return (
    <details className="inline-block align-middle">
      <summary className="cursor-pointer select-none whitespace-nowrap">
        <span className="font-medium">{maskName(name)}</span> <span className="mono text-xs text-muted">{maskPhone(p)}</span>{" "}
        <span className="text-xs text-accent">보기</span>
      </summary>
      <div className="mt-1 text-sm">
        <span className="font-medium">{name}</span> <span className="mono">{phone(p)}</span>
        {email && <span className="text-xs text-muted ml-1">{email}</span>}
      </div>
    </details>
  );
}

/** 목록 표의 빈 줄 */
export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="text-muted text-center py-6">
        {children}
      </td>
    </tr>
  );
}
