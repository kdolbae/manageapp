import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createNotice } from "@/lib/actions/groupware";
import { isExpired, ymdKST } from "@/lib/groupware";
import { branchOptions } from "@/app/(app)/people/data";

export const metadata = { title: "공지" };

type Row = {
  id: string;
  title: string;
  branch_id: string | null;
  pinned: boolean;
  published_at: string;
  expires_at: string | null;
  created_by: string | null;
  author: { display_name: string } | null;
  branch: { name: string } | null;
};
type Read = { notice_id: string; profile_id: string };

export default async function NoticesPage({ searchParams }: PageProps<"/groupware">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const me = session.user.id;
  const sp = await searchParams;
  const all = sp.all === "1";
  const canWrite = session.can("notice.write");
  const supabase = await createClient();
  const now = new Date().toISOString();

  let query = supabase
    .from("notice")
    .select("id, title, branch_id, pinned, published_at, expires_at, created_by, author:profile(display_name), branch:branch(name)")
    .eq("tenant_id", tid)
    .is("deleted_at", null);
  if (!all) query = query.or(`expires_at.is.null,expires_at.gt.${now}`);
  const [{ data: rows }, branches] = await Promise.all([
    query.order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(200),
    canWrite ? branchOptions(supabase, tid) : [],
  ]);
  const list = (rows ?? []) as unknown as Row[];
  const ids = list.map((n) => n.id);
  // 내 읽음은 누구나, 전체 읽음 통계는 공지 작성 권한자만 RLS 가 보여준다
  const { data: reads } = ids.length ? await supabase.from("notice_read").select("notice_id, profile_id").in("notice_id", ids) : { data: [] as Read[] };
  const readRows = (reads ?? []) as Read[];
  const mine = new Set(readRows.filter((r) => r.profile_id === me).map((r) => r.notice_id));
  const readCount = new Map<string, number>();
  for (const r of readRows) readCount.set(r.notice_id, (readCount.get(r.notice_id) ?? 0) + 1);
  const unread = list.filter((n) => !mine.has(n.id)).length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        <Link href="/groupware" className={`chip ${all ? "" : "is-active"}`}>현재 공지</Link>
        <Link href="/groupware?all=1" className={`chip ${all ? "is-active" : ""}`}>지난 공지 포함</Link>
        <span className="ml-auto text-xs text-muted">{unread > 0 ? `안 읽은 공지 ${unread}건` : "모두 읽었습니다"}</span>
      </div>
      <div className={"grid gap-4 p-4 items-start" + (canWrite ? " lg:grid-cols-[1fr_340px]" : "")}>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>제목</th>
                <th>대상</th>
                <th>작성자</th>
                <th>게시일</th>
                <th>읽음</th>
                {canWrite && <th className="text-right">읽은 사람</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((n) => {
                const expired = isExpired(n.expires_at, now);
                return (
                  <tr key={n.id} className={expired ? "opacity-60" : ""}>
                    <td>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {n.pinned && <span className="badge badge-run">고정</span>}
                        <Link href={`/groupware/${n.id}`} className={"text-text no-underline " + (mine.has(n.id) ? "font-medium" : "font-bold")}>{n.title}</Link>
                        {expired && <span className="badge badge-wait">만료</span>}
                      </div>
                    </td>
                    <td className="text-xs">{n.branch?.name ?? "전체"}</td>
                    <td className="text-xs">{n.author?.display_name ?? <span className="zero">—</span>}</td>
                    <td className="mono text-xs text-muted whitespace-nowrap">
                      {ymdKST(n.published_at)}
                      {n.expires_at && <div>~{ymdKST(n.expires_at)}</div>}
                    </td>
                    <td>{mine.has(n.id) ? <span className="badge badge-wait">읽음</span> : <span className="badge badge-run">안읽음</span>}</td>
                    {canWrite && <td className="num text-xs">{readCount.get(n.id) ?? 0}명 읽음</td>}
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 6 : 5} className="text-muted">
                    {all ? "공지가 없습니다." : "현재 공지가 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={canWrite ? 6 : 5}>{list.length}건 · 고정 공지가 먼저, 그다음 최근 게시 순</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {canWrite && (
          <ActionForm action={createNotice} className="card p-4">
            <h2 className="text-sm font-semibold mb-1">공지 쓰기</h2>
            <p className="text-xs text-muted mb-3">구성원 모두(또는 한 지점)에게 보입니다. 만료일이 지나면 목록에서 숨겨집니다.</p>
            <div className="form-row">
              <label className="label" htmlFor="notice-title">제목<span className="req">*</span></label>
              <input id="notice-title" name="title" required maxLength={120} className="field" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="notice-branch">대상</label>
              <select id="notice-branch" name="branch_id" className="field" defaultValue={session.current.branch_id ?? ""}>
                <option value="">전 지점</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-x-2">
              <div className="form-row">
                <label className="label" htmlFor="notice-expires">만료일</label>
                <input id="notice-expires" name="expires_at" type="date" className="field mono" />
              </div>
              <div className="form-row flex items-end pb-2.5">
                <label className="chip">
                  <input type="checkbox" name="pinned" /> 상단 고정
                </label>
              </div>
            </div>
            <div className="form-row">
              <label className="label" htmlFor="notice-body">내용</label>
              <textarea id="notice-body" name="body" rows={6} maxLength={10000} className="field" />
            </div>
            <SubmitButton>공지 올리기</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
