import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { acceptInvitation } from "@/lib/actions/auth";

export const metadata = { title: "초대 수락" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const result = await acceptInvitation(token);
  if (result.ok) redirect("/");

  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="card p-5 w-full max-w-[420px]">
        <h1 className="text-base font-semibold mb-2">초대를 수락하지 못했습니다</h1>
        <p className="text-sm text-muted mb-3">
          링크가 만료되었거나, 초대받은 이메일({session.user.email})과 다른 계정으로 로그인되어 있습니다.
        </p>
        <p className="text-xs text-muted mb-4 mono">{result.error}</p>
        <div className="flex gap-2">
          <Link href="/" className="btn">홈으로</Link>
          <form action="/auth/signout" method="post"><button className="btn">다른 계정으로 로그인</button></form>
        </div>
      </div>
    </main>
  );
}
