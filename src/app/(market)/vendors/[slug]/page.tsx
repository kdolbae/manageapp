import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedUrlMap, STAR } from "@/lib/public";
import { categoryLabels, maskName, platformCategories } from "@/lib/market";
import { vendorBySlug } from "@/lib/market-public";
import { shortDate, won } from "@/lib/format";

type Review = { id: string; rating: number | null; body: string | null; author_name: string | null; response: string | null; created_at: string };
type Photo = { id: string; path: string; kind: string; caption: string | null };

export async function generateMetadata({ params }: PageProps<"/vendors/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const admin = createAdminClient();
  const v = admin ? await vendorBySlug(admin, slug) : null;
  if (!v) return { title: "업체 소개" };
  const tagline = typeof v.brand?.tagline === "string" ? v.brand.tagline : null;
  return { title: v.name, description: tagline ?? v.intro?.slice(0, 120) ?? `${v.name} 업체 소개 · 집대리` };
}

export default async function VendorPage({ params }: PageProps<"/vendors/[slug]">) {
  const { slug } = await params;
  const admin = createAdminClient();
  if (!admin) return <section className="card p-5 text-sm text-muted">지금은 열 수 없습니다. 잠시 뒤 다시 시도해 주세요.</section>;
  const v = await vendorBySlug(admin, slug);
  if (!v) notFound();

  const [cats, { data: photos }, { data: reviews }] = await Promise.all([
    platformCategories(admin),
    admin.from("media_asset").select("id, path, kind, caption").eq("tenant_id", v.tenant_id).eq("marketing_ok", true).is("deleted_at", null).in("kind", ["after", "before"]).order("created_at", { ascending: false }).limit(9),
    admin.from("review").select("id, rating, body, author_name, response, created_at").eq("tenant_id", v.tenant_id).eq("status", "approved").is("deleted_at", null).order("created_at", { ascending: false }).limit(6),
  ]);
  const ph = (photos ?? []) as Photo[];
  const rv = (reviews ?? []) as Review[];
  const urls = await signedUrlMap(admin, [v.cover_path, v.logo_path, ...ph.map((p) => p.path)].filter((p): p is string => Boolean(p)));
  const cover = v.cover_path ? urls.get(v.cover_path) : undefined;
  const logo = v.logo_path ? urls.get(v.logo_path) : undefined;
  const tagline = typeof v.brand?.tagline === "string" ? v.brand.tagline : null;
  const rating = v.rating != null ? Number(v.rating) : null;

  return (
    <>
      <article className="card overflow-hidden">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="w-full h-[160px] object-cover" />
        )}
        <div className="p-5">
          <div className="flex items-start gap-3">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="w-14 h-14 rounded object-cover border border-border shrink-0 bg-bg" />
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-snug flex items-center gap-2 flex-wrap">
                {v.name}
                {v.featured && <span className="badge badge-run">광고</span>}
              </h1>
              {tagline && <p className="text-sm text-muted mt-0.5">{tagline}</p>}
            </div>
          </div>
          <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-sm mt-4">
            <dt className="text-muted">서비스</dt>
            <dd>{categoryLabels(v.categories, cats) || "분류 미정"}</dd>
            <dt className="text-muted">시공 지역</dt>
            <dd>{v.regions.length ? v.regions.join(" · ") : "전국"}</dd>
            {v.min_price != null && (
              <>
                <dt className="text-muted">최저 가격</dt>
                <dd><b className="mono">{won(v.min_price)}</b>원부터</dd>
              </>
            )}
            {v.response_note && (
              <>
                <dt className="text-muted">응답</dt>
                <dd>{v.response_note}</dd>
              </>
            )}
          </dl>
          <div className="flex items-center gap-3 text-sm mt-3">
            {rating != null ? (
              <span><span className="text-warn">{STAR(Math.round(rating))}</span> <b>{rating.toFixed(1)}</b> <span className="text-muted">· 후기 {v.review_count}건</span></span>
            ) : (
              <span className="text-muted">후기 준비 중</span>
            )}
            <span className="text-muted">· 시공 {v.done_jobs}건</span>
          </div>
          {v.highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">{v.highlights.map((h) => <span key={h} className="chip">{h}</span>)}</div>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href={`/request?vendor=${v.slug}`} className="btn btn-primary btn-lg">이 업체에 견적 요청</Link>
            <Link href="/request" className="btn btn-lg">전체 업체 견적 비교</Link>
            <Link href={`/c/${v.slug}`} className="btn btn-lg">업체 홈페이지</Link>
          </div>
        </div>
      </article>

      {v.intro && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold mb-2">업체 소개</h2>
          <p className="text-sm whitespace-pre-wrap">{v.intro}</p>
        </section>
      )}

      {ph.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold mb-3">시공 사진</h2>
          <div className="grid grid-cols-3 gap-1.5">
            {ph.map((p) => {
              const u = urls.get(p.path);
              return u ? (
                <figure key={p.id} className="m-0 aspect-square overflow-hidden rounded bg-bg relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={p.caption ?? ""} loading="lazy" className="w-full h-full object-cover" />
                  <figcaption className="absolute left-1 bottom-1 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">{p.kind === "before" ? "시공 전" : "시공 후"}</figcaption>
                </figure>
              ) : null;
            })}
          </div>
        </section>
      )}

      {rv.length > 0 && (
        <section className="card">
          <div className="panel-head"><h2>고객 후기 <span className="sub">{v.review_count}건</span></h2></div>
          <ul className="divide-y divide-border">
            {rv.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between text-xs"><span className="text-warn">{STAR(r.rating ?? 0)}</span><span className="text-muted">{maskName(r.author_name)} · {shortDate(r.created_at)}</span></div>
                <p className="mt-1 whitespace-pre-wrap">{r.body}</p>
                {r.response && <p className="mt-2 text-xs text-muted border-l-2 border-border pl-2"><b>{v.name}</b> {r.response}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{v.name}에 견적을 받아 보세요</p>
          <p className="text-xs text-muted">전화번호는 업체에 보이지 않고, 진행을 결정한 뒤 공개를 켤 때만 보입니다.</p>
        </div>
        <Link href={`/request?vendor=${v.slug}`} className="btn btn-primary">이 업체에 견적 요청</Link>
      </section>
    </>
  );
}
