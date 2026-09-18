import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "집대리 — 계약·데이터 자산화 플랫폼",
  description: "UPIS를 대체하고 계약 데이터를 자산으로 관리하는 플랫폼",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
