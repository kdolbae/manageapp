import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { signUp } from "@/lib/actions/auth";

export const metadata = { title: "계정 만들기" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/onboarding";
  return (
    <>
      <h1 className="text-base font-semibold mb-1">계정 만들기</h1>
      <p className="text-xs text-muted mb-4">초대 링크로 오셨다면 같은 이메일로 만들어 주세요.</p>
      <ActionForm action={signUp}>
        <input type="hidden" name="next" value={next} />
        <div className="form-row">
          <label className="label" htmlFor="display_name">이름<span className="req">*</span></label>
          <input id="display_name" name="display_name" required maxLength={40} className="field" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="email">이메일<span className="req">*</span></label>
          <input id="email" name="email" type="email" autoComplete="email" required className="field" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="password">비밀번호 (8자 이상)<span className="req">*</span></label>
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className="field" />
        </div>
        <SubmitButton className="btn btn-primary w-full mt-2">계정 만들기</SubmitButton>
      </ActionForm>
      <p className="text-xs text-muted mt-4 text-center">
        이미 계정이 있으면 <Link href="/login">로그인</Link>
      </p>
    </>
  );
}
