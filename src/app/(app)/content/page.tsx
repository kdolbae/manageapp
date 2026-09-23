import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { shortDate } from "@/lib/format";
import { workAreaClass } from "@/lib/contracts";
import { MEDIA_KIND, signedUrlMap } from "@/lib/media";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { updateMedia } from "@/lib/actions/media";
import { KindBadge, Thumb } from "./media-ui";

export const metadata = { title: "사진·후기·콘텐츠" };

type Photo = {
  id: string;
  job_id: string | null;
  contract_id: string | null;
  kind: string;
  path: string;
  caption: string | null;
  marketing_ok: boolean;
  work_area_code: string | null;
  taken_at: string | null;
  created_at: string;
  contract: { contract_no: string; customer: { name: string } | null } | null;
};

export default async function ContentPage({ searchParams }: PageProps<"/content">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const marketing = sp.marketing === "1";
  const kind = typeof sp.kind === "string" && Object.hasOwn(MEDIA_KIND, sp.kind) ? sp.kind : "";
  const wa = typeof sp.wa === "string" ? sp.wa.slice(0, 30) : "";
  const supabase = await createClient();

  let query = supabase
    .from("media_asset")
    .select("id, job_id, contract_id, kind, path, caption, marketing_ok, work_area_code, taken_at, created_at, contract:contract(contract_no, customer:customer(name))")
    .eq("tenant_id", tid)
    .is("deleted_at", null);
  if (marketing) query = query.eq("marketing_ok", true);
  if (kind) query = query.eq("kind", kind);
  if (wa) query = query.eq("work_area_code", wa);
  const [{ data: photos }, workAreas] = await Promise.all([query.order("created_at", { ascending: false }).limit(200), codeValues(tid, "work_area")]);
  const list = (photos ?? []) as unknown as Photo[];
  const urls = await signedUrlMap(supabase, list.map((p) => p.path));
  const canPublish = session.can("content.publish");

  const href = (patch: { marketing?: boolean; kind?: string; wa?: string }) => {
    const p = new URLSearchParams();
    if (patch.marketing ?? marketing) p.set("marketing", "1");
    const k = patch.kind ?? kind;
    if (k) p.set("kind", k);
    const w = patch.wa ?? wa;
    if (w) p.set("wa", w);
    const s = p.toString();
    return s ? `/content?${s}` : "/content";
  };
  const waMark = (code: string | null) => {
    const i = workAreas.findIndex((w) => w.code === code);
    if (i < 0) return null;
    const w = workAreas[i];
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`mark mark-${workAreaClass(w.color, i)}`}>{w.label.slice(0, 1)}</span>
        {w.label}
      </span>
    );
  };

  return (
    <div className="p-4 grid gap-3">
      <p className="text-sm text-muted">
        콘텐츠에는 <b className="text-text">마케팅 사용 가능</b>으로 표시한 사진만 넣을 수 있습니다{canPublish ? " — 고객 동의를 확인한 뒤 사진마다 켜 주세요." : ". 표시는 발행 권한이 있는 사람이 켭니다."}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={href({ marketing: false })} className={`chip ${!marketing ? "is-active" : ""}`}>전체</Link>
        <Link href={href({ marketing: true })} className={`chip ${marketing ? "is-active" : ""}`}>마케팅 사용 가능만</Link>
        <span className="w-px h-5 bg-border mx-1" aria-hidden />
        <Link href={href({ kind: "" })} className={`chip ${!kind ? "is-active" : ""}`}>모든 종류</Link>
        {Object.entries(MEDIA_KIND).map(([k, v]) => (
          <Link key={k} href={href({ kind: k })} className={`chip ${kind === k ? "is-active" : ""}`}>{v}</Link>
        ))}
        {workAreas.length > 0 && (
          <>
            <span className="w-px h-5 bg-border mx-1" aria-hidden />
            <Link href={href({ wa: "" })} className={`chip ${!wa ? "is-active" : ""}`}>모든 작업 단위</Link>
            {workAreas.map((w) => (
              <Link key={w.code} href={href({ wa: w.code })} className={`chip ${wa === w.code ? "is-active" : ""}`}>{w.label}</Link>
            ))}
          </>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {list.map((p) => {
          const url = urls.get(p.path);
          const target = p.job_id ? `/jobs/${p.job_id}` : p.contract_id ? `/contracts/${p.contract_id}` : null;
          const alt = p.caption ?? MEDIA_KIND[p.kind] ?? "사진";
          return (
            <div key={p.id} className={`card overflow-hidden ${p.marketing_ok ? "outline-2 outline-success" : ""}`}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer"><Thumb src={url} alt={alt} /></a>
              ) : (
                <Thumb src={undefined} alt={alt} />
              )}
              <div className="p-2 grid gap-1 text-xs">
                <div className="flex items-center justify-between gap-1 flex-wrap">
                  <KindBadge kind={p.kind} />
                  {p.marketing_ok && <span className="badge badge-done">마케팅</span>}
                </div>
                <div className="flex items-center justify-between gap-1">
                  {waMark(p.work_area_code) ?? <span className="text-muted">—</span>}
                  <span className="mono text-muted">{shortDate(p.taken_at ?? p.created_at)}</span>
                </div>
                {p.caption && <div className="truncate" title={p.caption}>{p.caption}</div>}
                {target ? (
                  <Link href={target} className="truncate mono">
                    {p.contract?.contract_no ?? "시공 건"}
                    {p.contract?.customer?.name ? ` · ${p.contract.customer.name}` : ""}
                  </Link>
                ) : (
                  <span className="text-muted">연결된 시공 없음</span>
                )}
                {canPublish && (
                  <ActionForm action={updateMedia} className="mt-1">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="set_marketing" value="1" />
                    <input type="hidden" name="marketing_ok" value={p.marketing_ok ? "0" : "1"} />
                    <SubmitButton className="btn btn-sm w-full">{p.marketing_ok ? "마케팅 사용 끄기" : "마케팅 사용 켜기"}</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="col-span-full card p-8 text-center text-sm text-muted">조건에 맞는 사진이 없습니다. 사진은 시공 건 상세(계약 → 시공 건 → 사진·상세)에서 올립니다.</div>}
      </div>
      <div className="mono text-xs text-muted">{list.length}장{list.length >= 200 ? " (최근 200장만)" : ""}</div>
    </div>
  );
}
