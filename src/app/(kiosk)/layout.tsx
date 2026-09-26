/**
 * 고객에게 기기를 건네는 화면(현장 서명 등)의 껍데기.
 * 앱 사이드바·헤더·모바일 탭 없이 본문만 그린다 — 태블릿을 든 고객이 관리 화면으로 넘어가지 못하게.
 * 로그인은 proxy.ts 가 강제한다 (/sign/... 은 공개 경로가 아니다). html/body/폰트는 루트 레이아웃 몫.
 */
export const dynamic = "force-dynamic";

export default function KioskLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh bg-bg">
      <main className="max-w-[820px] mx-auto px-4 py-5 grid gap-4">{children}</main>
    </div>
  );
}
