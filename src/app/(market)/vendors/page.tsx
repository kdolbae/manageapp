import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { REGIONS, categoryLabels, platformCategories } from "@/lib/market";
import { vendorCards } from "@/lib/market-public";
import { won } from "@/lib/format";

export const metadata: Metadata = {
  title: "업체 찾기",
  description: "입주 청소·코팅·줄눈·필름·블라인드 등 입주 시공 업체를 지역과 분류로 찾고 견적을 비교하세요.",
  robots: { index: true, follow: true },
};

export default async function VendorsPage({ searchParams }: PageProps<"/vendors">) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const region = (REGIONS as readonly string[]).includes(pick("region")) ? pick("region") : "";
  const admin = createAdminClient();
  if (!admin) return <section className="card p-5 text-sm text-muted">지금은 열 수 없습니다. 잠시 뒤 다시 시도해 주세요.</section>;
  const cats = await platformCategories(admin);
  const cat = cats.some((c) => c.code === pick("cat")) ? pick("cat") : "";
  const vendors = await vendorCards(admin, { cat: cat || undefined, region: region || undefined });
  const href = (next: { cat?: string; region?: string }) => {
    const p = new URLSearchParams();
    const c = next.cat ?? cat;
    const r = next.region ?? region;
    if (c) p.set("cat", c);
    if (r) p.set("region", r);
    const s = p.toString();
    return s ? `/vendors?${s}` : "/vendors";
  };

  return (
    <>
      <section className="card p-5">
        <h1 className="text-xl font-bold leading-snug">입주 시공, 여러 업체 견적을 한 번에</h1>
        <p className="text-sm text-muted mt-1">청소·코팅·줄눈·필름… 조건만 남기면 검증된 업체들이 견적을 보냅니다. 전화번호는 직접 선택한 업체에게만 공개됩니다.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Link href="/request" className="btn btn-primary btn-lg">여러 업체 견적 한 번에 받기</Link>
          <Link href="/apply" className="btn btn-lg">협력업체 신청</Link>
        </div>
      </section>

      <section className="card p-4 grid gap-3">
        <div>
          <div className="label">서비스 분류</div>
          <div className="flex flex-wrap gap-1.5">
            <Link href={href({ cat: "" })} className={`chip no-underline ${cat ? "" : "is-active"}`}>전체</Link>
            {cats.map((c) => (
              <Link key={c.code} href={href({ cat: c.code })} className={`chip no-underline ${cat === c.code ? "is-active" : ""}`}>{c.label}</Link>
            ))}
          </div>
        </div>
        <div>
          <div className="label">지역</div>
          <div className="flex flex-wrap gap-1.5">
            <Link href={href({ region: "" })} className={`chip no-underline ${region ? "" : "is-active"}`}>전체</Link>
            {REGIONS.map((r) => (
              <Link key={r} href={href({ region: r })} className={`chip no-underline ${region === r ? "is-active" : ""}`}>{r}</Link>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <p className="text-xs text-muted px-1">업체 {vendors.length}곳{cat || region ? " · 조건에 맞는 업체" : ""}</p>
        {vendors.length === 0 && (
          <div className="card p-5 text-center">
            <p className="text-sm font-medium">조건에 맞는 업체가 아직 없습니다</p>
            <p className="text-xs text-muted mt-1">조건을 바꿔 보거나, 요청을 남기면 맞는 업체가 생길 때 견적을 받을 수 있습니다.</p>
            <div className="flex justify-center gap-2 mt-3">
              <Link href="/vendors" className="btn btn-sm">조건 지우기</Link>
              <Link href="/request" className="btn btn-primary btn-sm">견적 요청 남기기</Link>
            </div>
          </div>
        )}
        {vendors.map((v) => (
          <article key={v.tenant_id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-snug flex items-center gap-2 flex-wrap">
                  <Link href={`/vendors/${v.slug}`} className="no-underline text-text">{v.name}</Link>
                  {v.featured && <span className="badge badge-run">광고</span>}
                </h2>
                <p className="text-xs text-muted mt-0.5">{categoryLabels(v.categories, cats) || "분류 미정"}</p>
                <p className="text-xs text-muted">{v.regions.length ? v.regions.join(" · ") : "전국"}</p>
              </div>
              <div className="text-right shrink-0 text-xs">
                {v.rating != null ? (
                  <div><span className="text-warn">★</span> <b>{Number(v.rating).toFixed(1)}</b> <span className="text-muted">({v.review_count})</span></div>
                ) : (
                  <div className="text-muted">후기 준비 중</div>
                )}
                <div className="text-muted mt-0.5">시공 {v.done_jobs}건</div>
              </div>
            </div>
            {v.intro && <p className="text-sm mt-2 line-clamp-2 whitespace-pre-line">{v.intro}</p>}
            {v.highlights.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">{v.highlights.map((h) => <span key={h} className="chip">{h}</span>)}</div>
            )}
            <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
              <span className="text-sm">
                {v.min_price != null ? <><b className="mono">{won(v.min_price)}</b>원부터</> : <span className="text-muted">견적 문의</span>}
              </span>
              <div className="flex gap-2">
                <Link href={`/vendors/${v.slug}`} className="btn btn-sm">자세히</Link>
                <Link href={`/request?vendor=${v.slug}`} className="btn btn-primary btn-sm">견적 요청</Link>
              </div>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
