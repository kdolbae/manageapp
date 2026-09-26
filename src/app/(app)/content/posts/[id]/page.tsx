import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/inbox";
import { MEDIA_KIND, POST_KIND, POST_STATUS, hashtagText, postText, signedUrlMap } from "@/lib/media";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { deletePost, updatePost } from "@/lib/actions/media";
import { Thumb } from "../../media-ui";
import { PHOTO_SELECT, PostFields, REVIEW_SELECT, type PhotoOption, type PostValues, type ReviewOption } from "../post-fields";

export const metadata = { title: "콘텐츠" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Post = {
  id: string;
  kind: string;
  title: string | null;
  body: string | null;
  hashtags: string[];
  media_ids: string[];
  review_id: string | null;
  contract_id: string | null;
  status: string;
  published_at: string | null;
  published_url: string | null;
  created_at: string;
  updated_at: string;
};

export default async function PostPage({ params }: PageProps<"/content/posts/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const { data: post } = await supabase.from("content_post").select("*").eq("id", id).eq("tenant_id", tid).is("deleted_at", null).maybeSingle();
  if (!post) notFound();
  const p = post as Post;
  const mediaIds = p.media_ids ?? [];

  const [{ data: reviews }, { data: marketing }, { data: selected }] = await Promise.all([
    supabase.from("review").select(REVIEW_SELECT).eq("tenant_id", tid).eq("status", "approved").is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    supabase.from("media_asset").select(PHOTO_SELECT).eq("tenant_id", tid).eq("marketing_ok", true).is("deleted_at", null).order("created_at", { ascending: false }).limit(60),
    mediaIds.length
      ? supabase.from("media_asset").select(PHOTO_SELECT).in("id", mediaIds).eq("tenant_id", tid).is("deleted_at", null)
      : Promise.resolve({ data: [] as PhotoOption[] }),
  ]);
  // 고른 사진을 앞에, 나머지 마케팅 사용 가능 사진을 뒤에
  const chosen = (selected ?? []) as PhotoOption[];
  const rest = ((marketing ?? []) as PhotoOption[]).filter((m) => !chosen.some((c) => c.id === m.id));
  const photoList = [...chosen, ...rest];
  const urls = await signedUrlMap(supabase, photoList.map((x) => x.path));

  const st = POST_STATUS[p.status] ?? { label: p.status, badge: "wait" as const };
  const canWrite = session.can("content.write");
  const values: PostValues = { kind: p.kind, title: p.title, body: p.body, hashtags: p.hashtags ?? [], media_ids: mediaIds, review_id: p.review_id, status: p.status, published_url: p.published_url };
  const copy = postText(p.body, p.hashtags);

  return (
    <div className="p-4 grid gap-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="card min-w-0">
        <div className="panel-head flex-wrap">
          <h2>
            <span className="truncate max-w-[420px]">{p.title || "(제목 없음)"}</span>
            <span className={`badge badge-${st.badge}`}>{st.label}</span>
          </h2>
          <Link href="/content/posts" className="btn btn-sm">목록</Link>
        </div>
        {canWrite ? (
          <ActionForm action={updatePost} className="p-4">
            <input type="hidden" name="id" value={p.id} />
            <PostFields values={values} reviews={(reviews ?? []) as unknown as ReviewOption[]} photos={photoList} urls={urls} canPublish={session.can("content.publish")} />
            <div className="flex gap-2 mt-1">
              <SubmitButton>저장</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <div className="p-4 grid gap-3 text-sm">
            <div className="whitespace-pre-wrap">{p.body || <span className="text-muted">본문이 없습니다.</span>}</div>
            {p.hashtags?.length > 0 && <div className="text-accent">{hashtagText(p.hashtags)}</div>}
            {chosen.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {chosen.map((m) => <Thumb key={m.id} src={urls.get(m.path)} alt={m.caption ?? MEDIA_KIND[m.kind] ?? "사진"} className="card" />)}
              </div>
            )}
          </div>
        )}
      </div>

      <aside className="grid gap-4 min-w-0">
        <section className="card p-4 text-sm grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">붙여넣기용 본문 + 해시태그</h2>
            {copy && <CopyButton text={copy} label="복사" />}
          </div>
          <pre className="whitespace-pre-wrap font-sans text-xs bg-bg border border-border rounded-[3px] p-2 max-h-[320px] overflow-auto">{copy || "저장된 본문이 없습니다."}</pre>
          <p className="text-[11px] text-muted">저장된 내용을 복사합니다. 고친 뒤에는 먼저 저장하세요.</p>
          <div className="grid grid-cols-[72px_1fr] gap-y-1 gap-x-2 text-xs mt-1">
            <span className="text-muted">채널</span><span>{POST_KIND[p.kind] ?? p.kind}</span>
            <span className="text-muted">사진</span><span>{mediaIds.length}장{chosen.length < mediaIds.length ? ` (${mediaIds.length - chosen.length}장은 지워짐)` : ""}</span>
            <span className="text-muted">후기</span><span>{p.review_id ? "연결됨" : "—"}</span>
            <span className="text-muted">계약</span><span>{p.contract_id ? <Link href={`/contracts/${p.contract_id}`}>계약 보기</Link> : "—"}</span>
            <span className="text-muted">만든 날짜</span><span className="mono">{fmtDateTime(p.created_at)}</span>
            <span className="text-muted">발행</span><span className="mono">{p.published_at ? fmtDateTime(p.published_at) : "—"}</span>
          </div>
          {p.published_url && <a href={p.published_url} target="_blank" rel="noreferrer" className="btn btn-sm mt-1">발행된 글 열기</a>}
        </section>
        {canWrite && (
          <details className="card p-4">
            <summary className="cursor-pointer text-danger text-sm">이 콘텐츠 삭제</summary>
            <form action={deletePost} className="mt-2 grid gap-2">
              <input type="hidden" name="id" value={p.id} />
              <p className="text-xs text-muted">목록에서 사라집니다(기록은 보존). 사진과 후기는 그대로 남습니다.</p>
              <button className="btn btn-sm btn-danger">삭제 확인</button>
            </form>
          </details>
        )}
      </aside>
    </div>
  );
}
