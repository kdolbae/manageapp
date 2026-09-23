import type { Metadata } from "next";
import { OfflineActions } from "./offline-actions";

// 서비스 워커가 미리 담아 두었다가 연결이 없을 때 보여 주는 페이지.
// 쿠키·세션을 읽지 않는 정적 페이지여야 한다 (빌드 때 프리렌더).
export const metadata: Metadata = { title: "오프라인" };
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-5 text-center">
          <div className="text-xl font-bold tracking-tight">집대리</div>
          <div className="text-xs text-muted mt-1">시공·계약·결제 관리</div>
        </div>
        <div className="card p-5 grid gap-3">
          <h1 className="text-base font-semibold">지금은 오프라인입니다</h1>
          <p className="text-sm text-muted">
            네트워크에 연결되면 화면이 다시 열립니다. 오프라인에서 누른 시공 시작·완료는 연결이 돌아오면 자동으로 전송됩니다.
          </p>
          <OfflineActions />
        </div>
      </div>
    </main>
  );
}
