import { createAdminClient } from "@/lib/supabase/admin";
import { publicTenant, signedUrlMap, STAR } from "@/lib/public";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { brandInquiry } from "@/lib/actions/public";
import { shortDate } from "@/lib/format";

type Review = { id: string; rating: number | null; body: string | null; author_name: string | null; response: string | null; created_at: string };
type Photo = { id: string; path: string; kind: string; caption: string | null; work_area_code: string | null };

function maskName(n: string | null) {
  if (!n) return "고객";
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0] + "*";
  return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
}

export default async function BrandPage({ params, searchParams }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const admin = createAdminClient();
  const t = admin ? await publicTenant(admin, slug) : null;
  if (!admin || !t) return null;
  const [{ data: reviews }, { data: photos }, { data: workAreas }] = await Promise.all([
    admin.from("review").select("id, rating, body, author_name, response, created_at").eq("tenant_id", t.id).eq("status", "approved").is("deleted_at", null).order("created_at", { ascending: false }).limit(12),
    admin.from("media_asset").select("id, path, kind, caption, work_area_code").eq("tenant_id", t.id).eq("marketing_ok", true).is("deleted_at", null).in("kind", ["after", "before"]).order("created_at", { ascending: false }).limit(12),
    admin.from("code_value").select("code, label").eq("tenant_id", t.id).eq("domain", "work_area"),
  ]);
  const rv = (reviews ?? []) as Review[];
  const ph = (photos ?? []) as Photo[];
  const urls = await signedUrlMap(admin, ph.map((p) => p.path));
  const waLabel = new Map(((workAreas ?? []) as { code: string; label: string }[]).map((w) => [w.code, w.label]));
  const avg = rv.length ? rv.reduce((s, r) => s + (r.rating ?? 0), 0) / rv.length : 0;
  const utm = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const name = t.brand.app_name || t.name;

  return (
    <>
      <section className="card p-5">
        <h1 className="text-xl font-bold leading-snug">{t.brand.tagline || `${name} 시공 문의`}</h1>
        <p className="text-sm text-muted mt-1">입주 전 시공, 코팅, 줄눈까지 한 번에. 아래 폼을 남기시면 담당자가 바로 연락드립니다.</p>
        {rv.length > 0 && <p className="text-sm mt-3"><span className="text-warn">{STAR(Math.round(avg))}</span> <b>{avg.toFixed(1)}</b> <span className="text-muted">· 고객 후기 {rv.length}건</span></p>}
        <div className="flex flex-wrap gap-2 mt-4">
          <a href="#inquiry" className="btn btn-primary btn-lg">견적·시공 문의</a>
          {t.brand.phone && <a href={`tel:${t.brand.phone.replace(/\D/g, "")}`} className="btn btn-lg">전화 {t.brand.phone}</a>}
          {t.brand.kakao_url && <a href={t.brand.kakao_url} className="btn btn-lg" target="_blank" rel="noreferrer">카카오톡 상담</a>}
        </div>
      </section>

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
                  <figcaption className="absolute left-1 bottom-1 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">{p.kind === "before" ? "시공 전" : "시공 후"}{p.work_area_code && ` · ${waLabel.get(p.work_area_code) ?? ""}`}</figcaption>
                </figure>
              ) : null;
            })}
          </div>
        </section>
      )}

      {rv.length > 0 && (
        <section className="card">
          <div className="panel-head"><h2>고객 후기</h2></div>
          <ul className="divide-y divide-border">
            {rv.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between text-xs"><span className="text-warn">{STAR(r.rating ?? 0)}</span><span className="text-muted">{maskName(r.author_name)} · {shortDate(r.created_at)}</span></div>
                <p className="mt-1 whitespace-pre-wrap">{r.body}</p>
                {r.response && <p className="mt-2 text-xs text-muted border-l-2 border-border pl-2"><b>{name}</b> {r.response}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="inquiry" className="card p-4">
        <h2 className="text-sm font-semibold mb-1">견적·시공 문의</h2>
        <p className="text-xs text-muted mb-3">남겨 주신 연락처는 상담 목적으로만 쓰고 원하시면 바로 지웁니다.</p>
        <ActionForm action={brandInquiry}>
          <input type="hidden" name="slug" value={t.slug} />
          {["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].map((k) => utm(k) && <input key={k} type="hidden" name={k} value={utm(k)} />)}
          <input type="hidden" name="source_page" value={`/c/${t.slug}`} />
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row"><label className="label" htmlFor="name">이름<span className="req">*</span></label><input id="name" name="name" required maxLength={60} className="field" /></div>
            <div className="form-row"><label className="label" htmlFor="phone">전화<span className="req">*</span></label><input id="phone" name="phone" type="tel" required maxLength={30} inputMode="tel" className="field mono" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row"><label className="label" htmlFor="apt">아파트·단지</label><input id="apt" name="apt" maxLength={100} className="field" /></div>
            <div className="form-row"><label className="label" htmlFor="kind">문의 종류</label><select id="kind" name="kind" className="field" defaultValue="견적"><option>견적</option><option>시공 예약</option><option>AS</option><option>기타</option></select></div>
          </div>
          <div className="form-row"><label className="label" htmlFor="message">내용</label><textarea id="message" name="message" rows={4} maxLength={2000} placeholder="입주 예정일, 원하시는 시공(주방 코팅, 욕실 줄눈 등)을 적어 주세요" className="field" /></div>
          <SubmitButton className="btn btn-primary btn-lg w-full">문의 보내기</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
