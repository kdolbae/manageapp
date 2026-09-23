import type { Metadata } from "next";
import Link from "next/link";

/** 집대리 마켓 공개 화면(업체 찾기·견적 요청·협력업체 신청·고객 요청 페이지)의 공통 껍데기. 로그인 없음 */

export function generateMetadata(): Metadata {
  return {
    title: { default: "집대리", template: "%s · 집대리" },
    description: "입주 시공(청소·코팅·줄눈·필름 등) 업체를 찾고 여러 업체 견적을 한 번에 비교하세요.",
  };
}

const NAV = [
  { href: "/vendors", label: "업체 찾기" },
  { href: "/request", label: "견적 요청" },
  { href: "/apply", label: "협력업체 신청" },
] as const;

export default function MarketLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-10 bg-surface border-b border-border">
        <div className="max-w-[720px] mx-auto px-4 h-[52px] flex items-center justify-between gap-3">
          <Link href="/vendors" className="no-underline text-text text-[15px] font-bold tracking-tight shrink-0">집대리</Link>
          <nav aria-label="마켓 메뉴" className="flex items-center gap-0.5 text-[12.5px] overflow-x-auto">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="px-2 py-1.5 rounded no-underline text-text hover:bg-zebra whitespace-nowrap">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-[720px] mx-auto px-4 py-5 grid gap-4">{children}</main>
      <footer className="max-w-[720px] mx-auto px-4 py-8 text-[11px] text-muted">집대리 · 입주 시공 견적 비교</footer>
    </div>
  );
}
