import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { POST_KIND, signedUrlMap } from "@/lib/media";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createPost } from "@/lib/actions/media";
import { EMPTY_POST, PHOTO_SELECT, PostFields, REVIEW_SELECT, type PhotoOption, type ReviewOption } from "../post-fields";

export const metadata = { title: "콘텐츠 만들기" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewPostPage({ searchParams }: PageProps<"/content/posts/new">) {
  const session = await requireTenant();
  if (!session.can("content.write")) redirect("/content/posts");
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: reviews }, { data: photos }] = await Promise.all([
    supabase.from("review").select(REVIEW_SELECT).eq("tenant_id", tid).eq("status", "approved").is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    supabase.from("media_asset").select(PHOTO_SELECT).eq("tenant_id", tid).eq("marketing_ok", true).is("deleted_at", null).order("created_at", { ascending: false }).limit(60),
  ]);
  const photoList = (photos ?? []) as PhotoOption[];
  const urls = await signedUrlMap(supabase, photoList.map((p) => p.path));
  // 후기 화면의 "이 후기로 콘텐츠 만들기" 등에서 넘어온 초기값
  const preset = {
    ...EMPTY_POST,
    kind: typeof sp.kind === "string" && Object.hasOwn(POST_KIND, sp.kind) ? sp.kind : EMPTY_POST.kind,
    review_id: typeof sp.review === "string" && UUID.test(sp.review) ? sp.review : null,
    media_ids: typeof sp.media === "string" ? sp.media.split(",").filter((v) => UUID.test(v)) : [],
  };

  return (
    <div className="p-4 max-w-[860px]">
      <div className="card">
        <div className="panel-head">
          <h2>콘텐츠 만들기</h2>
          <Link href="/content/posts" className="btn btn-sm">목록</Link>
        </div>
        <ActionForm action={createPost} className="p-4">
          <PostFields values={preset} reviews={(reviews ?? []) as unknown as ReviewOption[]} photos={photoList} urls={urls} canPublish={session.can("content.publish")} />
          <div className="flex gap-2 mt-1">
            <SubmitButton>만들기</SubmitButton>
            <Link href="/content/posts" className="btn">취소</Link>
          </div>
          <p className="text-xs text-muted mt-3">만든 뒤 상세 화면에서 본문·해시태그를 복사해 각 채널에 붙여 넣고, 올린 글 주소를 적어 발행됨으로 바꿉니다.</p>
        </ActionForm>
      </div>
    </div>
  );
}
