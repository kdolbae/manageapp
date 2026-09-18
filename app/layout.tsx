import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "집대리 — 계약·데이터 자산화 플랫폼",
  description: "UPIS를 대체하고 계약 데이터를 자산으로 관리하는 통합 관리 프로그램",
};

const nav = [
  { href: "/", label: "대시보드" },
  { href: "/contracts", label: "계약" },
  { href: "/parties", label: "거래처" },
  { href: "/settlements", label: "정산" },
  { href: "/assets", label: "데이터 자산" },
  { href: "/users", label: "사용자" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <div className="app">
          <aside className="sidebar">
            <div className="brand">
              집대리
              <small>계약·데이터 자산화 플랫폼</small>
            </div>
            <nav className="nav">
              {nav.map((n) => (
                <Link key={n.href} href={n.href}>
                  {n.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
