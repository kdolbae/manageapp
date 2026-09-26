import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createTenant } from "@/lib/actions/auth";

export const metadata = { title: "사업체 만들기" };

export default async function OnboardingPage() {
  const session = await requireSession();
  if (session.current) redirect("/");
  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        <div className="mb-5 text-center">
          <div className="text-xl font-bold tracking-tight">집대리</div>
        </div>
        <div className="card p-5">
          <h1 className="text-base font-semibold mb-1">첫 사업체 만들기</h1>
          <p className="text-xs text-muted mb-4">
            {session.profile?.display_name || session.user.email}님, 아직 소속된 사업체가 없습니다.
            새 사업체를 만들면 대표 권한으로 시작합니다. 초대를 받으셨다면 초대 링크를 다시 열어 주세요.
          </p>
          <ActionForm action={createTenant}>
            <div className="form-row">
              <label className="label" htmlFor="name">사업체 이름<span className="req">*</span></label>
              <input id="name" name="name" required maxLength={60} placeholder="예: 나노마스터" className="field" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="slug">주소 이름 (고객 페이지 주소에 쓰임)<span className="req">*</span></label>
              <input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9-]{1,30}" placeholder="예: nanomaster" className="field mono" />
            </div>
            <SubmitButton className="btn btn-primary w-full mt-2">사업체 만들기</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </main>
  );
}
