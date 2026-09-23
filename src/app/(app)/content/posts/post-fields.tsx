import { MEDIA_KIND, POST_KIND, POST_STATUS, hashtagText, stars } from "@/lib/media";
import { Thumb } from "../media-ui";

export type ReviewOption = { id: string; author_name: string | null; rating: number | null; body: string | null; contract: { contract_no: string } | null };
export type PhotoOption = { id: string; kind: string; caption: string | null; path: string; created_at: string };
export type PostValues = { kind: string; title: string | null; body: string | null; hashtags: string[]; media_ids: string[]; review_id: string | null; status: string; published_url: string | null };

export const EMPTY_POST: PostValues = { kind: "instagram", title: null, body: null, hashtags: [], media_ids: [], review_id: null, status: "draft", published_url: null };

export const REVIEW_SELECT = "id, author_name, rating, body, contract:contract(contract_no)";
export const PHOTO_SELECT = "id, kind, caption, path, created_at";

/** 콘텐츠 만들기·수정 공용 입력란. 폼(ActionForm) 안에서 쓴다. */
export function PostFields({ values, reviews, photos, urls, canPublish }: { values: PostValues; reviews: ReviewOption[]; photos: PhotoOption[]; urls: Map<string, string>; canPublish: boolean }) {
  return (
    <>
      <div className="grid gap-x-3 md:grid-cols-2">
        <div className="form-row">
          <label className="label">채널</label>
          <select name="kind" defaultValue={values.kind} className="field">
            {Object.entries(POST_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label className="label">상태</label>
          <select name="status" defaultValue={values.status} className="field">
            {Object.entries(POST_STATUS).map(([k, v]) => (
              <option key={k} value={k} disabled={k === "published" && !canPublish && values.status !== "published"}>
                {v.label}{k === "published" && !canPublish ? " (발행 권한 필요)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row"><label className="label">제목</label><input name="title" defaultValue={values.title ?? ""} className="field" maxLength={120} /></div>
      <div className="form-row">
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="label mb-0" htmlFor="post-body">본문</label>
          <button type="button" className="btn btn-sm" disabled title="AI 초안 생성은 곧 연결됩니다">AI 초안 (곧 연결)</button>
        </div>
        <textarea id="post-body" name="body" defaultValue={values.body ?? ""} className="field" rows={10} maxLength={5000} placeholder="채널에 올릴 본문" />
      </div>
      <div className="form-row">
        <label className="label">해시태그</label>
        <input name="hashtags" defaultValue={hashtagText(values.hashtags)} className="field" placeholder="#입주청소 #줄눈 (쉼표·공백으로 구분)" maxLength={1000} />
      </div>
      <div className="form-row">
        <label className="label">발행된 글 주소 <span className="text-muted">(상태가 발행됨이면 필수)</span></label>
        <input name="published_url" type="url" defaultValue={values.published_url ?? ""} className="field mono" placeholder="https://" maxLength={500} />
      </div>
      <div className="form-row">
        <label className="label">연결할 후기 <span className="text-muted">(승인된 후기만)</span></label>
        <select name="review_id" defaultValue={values.review_id ?? ""} className="field">
          <option value="">없음</option>
          {reviews.map((r) => (
            <option key={r.id} value={r.id}>
              {stars(r.rating)} {r.author_name ?? "고객"} · {(r.body ?? "").slice(0, 40)}{r.contract ? ` · ${r.contract.contract_no}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="label">사진 <span className="text-muted">(마케팅 사용 가능만)</span> <span className="mono">{photos.length}</span></label>
        {photos.length === 0 ? (
          <p className="text-xs text-muted">마케팅 사용 가능으로 표시된 사진이 없습니다. 사진 탭에서 먼저 표시해 주세요.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {photos.map((p) => {
              const alt = p.caption ?? MEDIA_KIND[p.kind] ?? "사진";
              return (
                <label key={p.id} className="relative block cursor-pointer card overflow-hidden has-[:checked]:outline-2 has-[:checked]:outline-accent">
                  <input type="checkbox" name="media_ids" value={p.id} defaultChecked={values.media_ids.includes(p.id)} className="absolute top-1.5 left-1.5 z-10 w-5 h-5" aria-label={alt} />
                  <Thumb src={urls.get(p.path)} alt={alt} />
                  <div className="px-1.5 py-1 text-[11px] truncate">{MEDIA_KIND[p.kind] ?? p.kind}{p.caption ? ` · ${p.caption}` : ""}</div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
