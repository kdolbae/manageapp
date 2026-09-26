import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { shortDate } from "@/lib/format";
import { POST_KIND, POST_STATUS } from "@/lib/media";

export const metadata = { title: "콘텐츠" };

type Post = { id: string; kind: string; title: string | null; status: string; published_url: string | null; published_at: string | null; media_ids: string[]; review_id: string | null; created_at: string };

export default async function PostsPage({ searchParams }: PageProps<"/content/posts">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && Object.hasOwn(POST_STATUS, sp.status) ? sp.status : "";
  const supabase = await createClient();
  let query = supabase.from("content_post").select("id, kind, title, status, published_url, published_at, media_ids, review_id, created_at").eq("tenant_id", tid).is("deleted_at", null);
  if (status) query = query.eq("status", status);
  const { data } = await query.order("created_at", { ascending: false }).limit(200);
  const list = (data ?? []) as Post[];

  return (
    <div className="p-4 grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href="/content/posts" className={`chip ${!status ? "is-active" : ""}`}>전체</Link>
        {Object.entries(POST_STATUS).map(([k, v]) => (
          <Link key={k} href={`/content/posts?status=${k}`} className={`chip ${status === k ? "is-active" : ""}`}>{v.label}</Link>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>채널</th><th>제목</th><th>상태</th><th className="text-right">사진</th><th>후기</th><th>발행 주소</th><th>만든 날짜</th></tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const st = POST_STATUS[p.status] ?? { label: p.status, badge: "wait" as const };
              return (
                <tr key={p.id}>
                  <td><span className="badge badge-wait">{POST_KIND[p.kind] ?? p.kind}</span></td>
                  <td><Link href={`/content/posts/${p.id}`} className="font-semibold text-text no-underline hover:text-accent">{p.title || "(제목 없음)"}</Link></td>
                  <td><span className={`badge badge-${st.badge}`}>{st.label}</span></td>
                  <td className="num">{p.media_ids?.length ?? 0}</td>
                  <td>{p.review_id ? "연결" : <span className="zero">—</span>}</td>
                  <td className="max-w-[260px]">{p.published_url ? <a href={p.published_url} target="_blank" rel="noreferrer" className="block truncate mono text-xs">{p.published_url}</a> : <span className="zero">—</span>}</td>
                  <td className="mono text-xs text-muted whitespace-nowrap">{shortDate(p.created_at)}{p.published_at && <span className="text-success"> · 발행 {shortDate(p.published_at)}</span>}</td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted">
                  {status ? "이 상태의 콘텐츠가 없습니다." : "아직 콘텐츠가 없습니다."}{session.can("content.write") && <> <Link href="/content/posts/new">첫 콘텐츠 만들기</Link></>}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot><tr><td colSpan={7}>{list.length}건</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}
