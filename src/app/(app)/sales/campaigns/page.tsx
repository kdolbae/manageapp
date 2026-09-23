import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/origin";
import { won } from "@/lib/format";
import { mmdd, todayKST } from "@/lib/dates";
import { sum, pctText } from "@/lib/stats";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { createCampaign, updateCampaign, deleteCampaign } from "@/lib/actions/campaigns";

export const metadata = { title: "캠페인" };

type Campaign = { id: string; name: string; channel: string; utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string | null; landing_path: string; budget: number | null; starts_on: string | null; ends_on: string | null; status: string; memo: string | null; created_at: string };
type Inq = { id: string; status: string; customer_id: string | null; contract_id: string | null; utm: Record<string, string>; created_at: string };
type Con = { id: string; customer_id: string | null; sale_total: number; canceled_at: string | null; approval_status: string };

const CHANNEL: Record<string, { label: string; source: string; medium: string }> = {
  instagram: { label: "인스타그램", source: "instagram", medium: "social" },
  naver: { label: "네이버(검색·블로그·플레이스)", source: "naver", medium: "search" },
  kakao: { label: "카카오(채널·모먼트)", source: "kakao", medium: "social" },
  google: { label: "구글 광고", source: "google", medium: "cpc" },
  meta: { label: "메타 광고(페이스북·인스타)", source: "meta", medium: "paid_social" },
  youtube: { label: "유튜브", source: "youtube", medium: "video" },
  blog: { label: "블로그·카페", source: "blog", medium: "referral" },
  fair: { label: "박람회·입주 행사", source: "fair", medium: "offline" },
  partner: { label: "협력업체·소개", source: "partner", medium: "referral" },
  offline: { label: "전단·현수막(QR)", source: "offline", medium: "print" },
  other: { label: "기타", source: "other", medium: "other" },
};
const STATUS: Record<string, { label: string; badge: string }> = { draft: { label: "준비", badge: "wait" }, active: { label: "진행", badge: "run" }, paused: { label: "일시 중지", badge: "wait" }, ended: { label: "종료", badge: "done" } };

function campaignUrl(origin: string, slug: string, c: Campaign) {
  const base = /^https?:\/\//.test(c.landing_path) ? c.landing_path : `${origin}/c/${slug}${c.landing_path.startsWith("/") ? c.landing_path : `/${c.landing_path}`}`;
  const q = new URLSearchParams({ utm_source: c.utm_source, utm_medium: c.utm_medium, utm_campaign: c.utm_campaign });
  if (c.utm_content) q.set("utm_content", c.utm_content);
  return `${base}${base.includes("?") ? "&" : "?"}${q.toString()}`;
}

export default async function CampaignsPage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const origin = await siteOrigin();
  const canEdit = session.can("content.publish");
  const [{ data: rows }, { data: inqRows }, { data: branches }] = await Promise.all([
    supabase.from("campaign").select("*").eq("tenant_id", tid).is("deleted_at", null).order("status").order("created_at", { ascending: false }),
    session.can("inquiry.read") ? supabase.from("inquiry").select("id, status, customer_id, contract_id, utm, created_at").eq("tenant_id", tid).is("deleted_at", null).not("utm", "eq", "{}") : Promise.resolve({ data: [] as Inq[] }),
    supabase.from("branch").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null),
  ]);
  const campaigns = (rows ?? []) as Campaign[];
  const inquiries = (inqRows ?? []) as Inq[];
  const customerIds = [...new Set(inquiries.map((i) => i.customer_id).filter(Boolean))] as string[];
  const { data: conRows } = customerIds.length && session.can("contract.read")
    ? await supabase.from("contract_summary").select("id, customer_id, sale_total, canceled_at, approval_status").eq("tenant_id", tid).in("customer_id", customerIds.slice(0, 500))
    : { data: [] as Con[] };
  const contracts = ((conRows ?? []) as Con[]).filter((c) => !c.canceled_at && c.approval_status !== "rejected");
  const byCampaign = (c: Campaign) => inquiries.filter((i) => (i.utm?.utm_campaign ?? "").toLowerCase() === c.utm_campaign && (i.utm?.utm_source ?? "").toLowerCase() === c.utm_source && (!c.utm_content || (i.utm?.utm_content ?? "") === c.utm_content));
  const today = todayKST();

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_360px] items-start">
      <div className="grid gap-4">
        <p className="text-xs text-muted">광고·게시물·전단 QR 마다 아래 링크를 쓰면 문의가 어느 캠페인에서 왔는지 자동으로 남고, 그 고객이 계약하면 매출까지 이어서 봅니다. 링크는 브랜드 페이지(/c/{session.current.tenant.slug})로 갑니다.</p>
        {campaigns.map((c) => {
          const inq = byCampaign(c);
          const cust = new Set(inq.map((i) => i.customer_id).filter(Boolean));
          const cons = contracts.filter((k) => k.customer_id && cust.has(k.customer_id));
          const sales = sum(cons, (k) => k.sale_total);
          const st = STATUS[c.status] ?? { label: c.status, badge: "wait" };
          const url = campaignUrl(origin, session.current.tenant.slug, c);
          const running = c.status === "active" && (!c.ends_on || c.ends_on >= today);
          return (
            <div key={c.id} className="card">
              <div className="panel-head">
                <h2>{c.name} <span className="sub">{CHANNEL[c.channel]?.label ?? c.channel}{c.starts_on || c.ends_on ? ` · ${c.starts_on ? mmdd(c.starts_on) : ""}~${c.ends_on ? mmdd(c.ends_on) : ""}` : ""}</span><span className={`badge badge-${st.badge} ml-2 align-middle`}>{running ? st.label : c.status === "active" ? "기간 종료" : st.label}</span></h2>
                <CopyButton text={url} label="링크 복사" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 border-b border-border">
                <div className="stat"><div className="k">문의</div><div className={`v ${inq.length ? "" : "zero"}`}>{inq.length}</div></div>
                <div className="stat"><div className="k">계약</div><div className={`v ${cons.length ? "" : "zero"}`}>{cons.length}<span className="text-xs text-muted font-normal ml-1">{pctText(cons.length, inq.length)}</span></div></div>
                <div className="stat"><div className="k">매출</div><div className={`v ${sales ? "" : "zero"}`}>{won(sales)}</div></div>
                <div className="stat"><div className="k">예산</div><div className={`v ${c.budget ? "" : "zero"}`}>{c.budget ? won(c.budget) : "—"}</div></div>
                <div className="stat"><div className="k">문의당 비용</div><div className={`v ${c.budget && inq.length ? "" : "zero"}`}>{c.budget && inq.length ? won(c.budget / inq.length) : "—"}</div></div>
              </div>
              <div className="px-4 py-2.5 text-xs">
                <div className="mono text-muted break-all">{url}</div>
                {c.memo && <div className="mt-1 text-muted">{c.memo}</div>}
              </div>
              {canEdit && (
                <details className="px-4 pb-3">
                  <summary className="text-xs text-accent cursor-pointer">수정 · 상태 변경</summary>
                  <ActionForm action={updateCampaign} className="mt-2 grid gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="form-row"><label className="label">이름</label><input name="name" defaultValue={c.name} maxLength={80} className="field" /></div>
                      <div className="form-row"><label className="label">상태</label><select name="status" defaultValue={c.status} className="field">{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
                      <div className="form-row"><label className="label">예산(원)</label><input name="budget" defaultValue={c.budget ?? ""} inputMode="numeric" className="field num" /></div>
                      <div className="form-row"><label className="label">utm_content</label><input name="utm_content" defaultValue={c.utm_content ?? ""} maxLength={80} className="field mono" /></div>
                      <div className="form-row"><label className="label">시작</label><input type="date" name="starts_on" defaultValue={c.starts_on ?? ""} className="field" /></div>
                      <div className="form-row"><label className="label">종료</label><input type="date" name="ends_on" defaultValue={c.ends_on ?? ""} className="field" /></div>
                      <div className="form-row sm:col-span-2"><label className="label">메모</label><input name="memo" defaultValue={c.memo ?? ""} maxLength={500} className="field" /></div>
                    </div>
                    <div className="flex items-center gap-2"><SubmitButton className="btn btn-sm btn-primary">저장</SubmitButton></div>
                  </ActionForm>
                  <form action={deleteCampaign} className="mt-2"><input type="hidden" name="id" value={c.id} /><button className="btn btn-sm btn-danger">캠페인 삭제</button></form>
                </details>
              )}
            </div>
          );
        })}
        {campaigns.length === 0 && <div className="card p-4 text-sm text-muted">아직 캠페인이 없습니다. 오른쪽에서 첫 캠페인을 만들면 붙여 넣을 링크가 나옵니다.</div>}
      </div>

      {canEdit ? (
        <ActionForm action={createCampaign} className="card p-4">
          <h2 className="text-sm font-semibold mb-1">캠페인 만들기</h2>
          <p className="text-xs text-muted mb-3">채널을 고르면 utm_source·medium 이 채워집니다. utm_campaign 은 광고 이름을 짧게(예: 2026_10_ipju).</p>
          <div className="form-row"><label className="label">이름<span className="req">*</span></label><input name="name" required maxLength={80} placeholder="10월 입주 인스타 광고" className="field" /></div>
          <div className="form-row"><label className="label">채널</label><select name="channel" className="field" defaultValue="instagram">{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row"><label className="label">utm_source<span className="req">*</span></label><input name="utm_source" required maxLength={60} defaultValue="instagram" className="field mono" /></div>
            <div className="form-row"><label className="label">utm_medium<span className="req">*</span></label><input name="utm_medium" required maxLength={60} defaultValue="social" className="field mono" /></div>
          </div>
          <div className="form-row"><label className="label">utm_campaign<span className="req">*</span></label><input name="utm_campaign" required maxLength={80} placeholder="2026_10_ipju" className="field mono" /></div>
          <div className="form-row"><label className="label">utm_content (소재 구분, 선택)</label><input name="utm_content" maxLength={80} placeholder="video_a" className="field mono" /></div>
          <div className="form-row"><label className="label">도착 페이지</label><input name="landing_path" defaultValue="/" maxLength={300} placeholder="/ 또는 https://..." className="field mono text-xs" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row"><label className="label">시작</label><input type="date" name="starts_on" className="field" /></div>
            <div className="form-row"><label className="label">종료</label><input type="date" name="ends_on" className="field" /></div>
          </div>
          <div className="form-row"><label className="label">예산(원)</label><input name="budget" inputMode="numeric" className="field num" /></div>
          {(branches ?? []).length > 1 && <div className="form-row"><label className="label">지점</label><select name="branch_id" className="field" defaultValue=""><option value="">전체</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
          <div className="form-row"><label className="label">메모</label><input name="memo" maxLength={500} className="field" /></div>
          <SubmitButton>만들기</SubmitButton>
        </ActionForm>
      ) : (
        <div className="card p-4 text-sm text-muted">캠페인은 콘텐츠 발행 권한이 있는 구성원이 만듭니다.</div>
      )}
    </div>
  );
}
