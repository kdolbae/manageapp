import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { signIn, signInWithMicrosoft } from "@/lib/actions/auth";

export const metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = typeof sp.error === "string" ? sp.error : null;
  const azure = process.env.NEXT_PUBLIC_AUTH_AZURE === "1";

  return (
    <>
      <h1 className="text-base font-semibold mb-4">로그인</h1>
      {error && <p className="notice notice-danger mb-3">로그인에 실패했습니다. 다시 시도해 주세요.</p>}
      <ActionForm action={signIn}>
        <input type="hidden" name="next" value={next} />
        <div className="form-row">
          <label className="label" htmlFor="email">이메일</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="field" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} className="field" />
        </div>
        <SubmitButton className="btn btn-primary w-full mt-2">로그인</SubmitButton>
      </ActionForm>
      {azure && (
        <form action={signInWithMicrosoft} className="mt-3">
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="btn w-full">Microsoft 계정으로 로그인</button>
        </form>
      )}
      <p className="text-xs text-muted mt-4 text-center">
        계정이 없으면 <Link href={`/signup?next=${encodeURIComponent(next)}`}>계정 만들기</Link>
      </p>
    </>
  );
}
