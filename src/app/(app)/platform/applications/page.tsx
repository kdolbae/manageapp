import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/origin";
import { phone } from "@/lib/format";
import { fmtDateTime } from "@/lib/inbox";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { approveVendor, rejectVendor } from "@/lib/actions/platform";
import { APPLICATION_STATUS, categoryLabels, platformCategories, platformContext } from "@/lib/market";
import { KV } from "@/app/(app)/people/shared";
import { Chips, StatusBadge } from "../shared";
import { APPLICATION_SELECT, filterParam, statusCounts, vendorsByIds, type Application, type PlatformVendor } from "../data";

export const metadata = { title: "협력업체 신청 심사" };

const FILTERS = ["pending", "approved", "rejected", "all"] as const;
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** 희망 주소를 사업체 slug 규칙(영문 소문자·숫자·하이픈, 2~31자)에 맞춘다. 못 맞추면 vendor-<신청 id 앞 6자리> */
function defaultSlug(a: Application): string {
  const s = (a.slug_wanted ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 31);
  return SLUG.test(s) ? s : `vendor-${a.id.slice(0, 6)}`;
}

function inviteMail(a: Application, link: string, platformName: string): string {
  const subject = `${platformName} 협력업체 승인 안내 — ${a.name}`;
  const body =
    `${a.name} ${a.ceo_name ? `${a.ceo_name} 대표님` : "담당자님"}, 안녕하세요. ${platformName}입니다.\n\n` +
    `협력업체 신청이 승인되었습니다. 아래 링크로 가입하면 대표 계정이 됩니다.\n${link}\n\n` +
    `- 신청하신 이메일(${a.email})로 로그인해야 초대가 수락됩니다.\n` +
    `- 링크는 30일 동안 유효합니다.\n` +
    `- 가입 뒤 '집대리 마켓' 메뉴에서 업체 소개를 채우면 운영자가 노출을 켭니다. 계약·시공 관리 프로그램은 바로 쓸 수 있습니다.\n\n감사합니다.`;
  return `mailto:${a.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** 승인된 신청의 대표 초대 상태. 대표가 아직 안 들어왔을 때만 초대 링크를 보여준다 (뷰의 pending 초대는 최신 1건이라 직원 초대일 수도 있다). */
function InviteBox({ a, v, origin, platformName }: { a: Application; v: PlatformVendor | undefined; origin: string; platformName: string }) {
  if (!v) return <p className="text-sm text-muted">업체 정보를 찾지 못했습니다. 사업체가 지워졌을 수 있습니다.</p>;
  const listing = v.is_listed ? (
    <span className="badge badge-done">노출 중</span>
  ) : (
    <Link href="/platform/vendors?f=unlisted" className="btn btn-sm">노출 켜기</Link>
  );
  if (Number(v.member_count) > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="badge badge-done">대표 계정 가입 완료</span>
        <span className="text-muted">구성원 {v.member_count}명 · 업체 주소 <span className="mono">/{v.slug}</span></span>
        {listing}
      </div>
    );
  }
  if (!v.pending_invite_token) {
    return <p className="text-sm text-warn">대표 초대가 만료되었거나 취소되었습니다. 재초대는 아직 지원하지 않습니다 — 업체 사업체에 다시 초대를 만들어야 합니다.</p>;
  }
  const link = `${origin}/invite/${v.pending_invite_token}`;
  return (
    <div>
      <div className="text-sm font-semibold mb-1">
        대표 초대 링크 <span className="text-xs text-muted font-normal">{v.pending_invite_email}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-muted break-all">{link}</span>
        <CopyButton text={link} />
        <a href={inviteMail(a, link, platformName)} className="btn btn-sm">메일로 보내기</a>
        {listing}
      </div>
      <p className="text-xs text-muted mt-1">신청자가 이 이메일로 로그인한 뒤 링크를 열면 새 사업체의 대표가 됩니다. 링크는 30일 동안 유효합니다.</p>
    </div>
  );
}

export default async function ApplicationsPage({ searchParams }: PageProps<"/platform/applications">) {
  const session = await requireTenant();
  const sp = await searchParams;
  const filter = filterParam(sp.s, FILTERS, "pending");
  const supabase = await createClient();
  const base = supabase.from("vendor_application").select(APPLICATION_SELECT);
  const [{ data: rows }, cats, counts, platform, origin] = await Promise.all([
    (filter === "all" ? base : base.eq("status", filter)).order("created_at", { ascending: false }).limit(200),
    platformCategories(supabase, false),
    statusCounts(supabase, "vendor_application", ["pending", "approved", "rejected"]),
    platformContext(supabase, session.current.tenant_id, session.can),
    siteOrigin(),
  ]);
  const apps = (rows ?? []) as Application[];
  const vendors = await vendorsByIds(supabase, apps.map((a) => a.tenant_id).filter((t): t is string => Boolean(t)));
  const vendorById = new Map(vendors.map((v) => [v.tenant_id, v]));

  return (
    <div>
      <Chips
        base="/platform/applications"
        param="s"
        value={filter}
        items={[
          { key: "pending", label: "심사 대기", count: counts.pending },
          { key: "approved", label: "승인", count: counts.approved },
          { key: "rejected", label: "반려", count: counts.rejected },
          { key: "all", label: "전체" },
        ]}
      />
      <div className="grid gap-4 p-4">
        {apps.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h2 className="text-base font-semibold">{a.name}</h2>
              <StatusBadge s={APPLICATION_STATUS[a.status]} fallback={a.status} />
              <span className="mono text-xs text-muted">{fmtDateTime(a.created_at)} 접수</span>
              {a.reviewed_at && <span className="mono text-xs text-muted">· {fmtDateTime(a.reviewed_at)} 처리</span>}
            </div>
            <div className="grid gap-x-6 md:grid-cols-2">
              <div>
                <KV k="사업자번호"><span className="mono">{a.business_no || "—"}</span></KV>
                <KV k="대표">{a.ceo_name || "—"}</KV>
                <KV k="전화"><span className="mono">{phone(a.phone)}</span></KV>
                <KV k="이메일"><a href={`mailto:${a.email}`}>{a.email}</a></KV>
                <KV k="주소">{a.address || "—"}</KV>
              </div>
              <div>
                <KV k="시공 지역">{a.regions.length ? a.regions.join(" · ") : "—"}</KV>
                <KV k="분류">{a.categories.length ? categoryLabels(a.categories, cats) : "—"}</KV>
                <KV k="홈페이지">
                  {a.website ? (
                    <a href={a.website} target="_blank" rel="noreferrer" className="break-all">{a.website}</a>
                  ) : (
                    "—"
                  )}
                </KV>
                <KV k="희망 주소"><span className="mono">{a.slug_wanted || "—"}</span></KV>
                <KV k="소개"><span className="whitespace-pre-wrap">{a.intro || "—"}</span></KV>
              </div>
            </div>

            {a.status === "pending" && (
              <div className="grid gap-4 md:grid-cols-2 mt-3 pt-3 border-t border-border">
                <ActionForm action={approveVendor}>
                  <input type="hidden" name="id" value={a.id} />
                  <h3 className="text-sm font-semibold mb-1">승인</h3>
                  <p className="text-xs text-muted mb-2">
                    사업체(본사 지점 포함)를 만들고 업체 소개·수수료(기본 계약금액 10%, 월말)를 준비한 뒤 신청 이메일로 대표 초대 링크를 만듭니다. 고객에게 노출하는
                    것은 따로 켭니다.
                  </p>
                  <div className="form-row">
                    <label className="label" htmlFor={`slug-${a.id}`}>
                      업체 주소(slug)<span className="req">*</span> <span className="text-muted">/vendors/…</span>
                    </label>
                    <input id={`slug-${a.id}`} name="slug" defaultValue={defaultSlug(a)} required pattern="[a-z0-9][a-z0-9-]{1,30}" className="field mono" />
                  </div>
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="승인하는 중…">승인하고 초대 링크 만들기</SubmitButton>
                </ActionForm>
                <ActionForm action={rejectVendor}>
                  <input type="hidden" name="id" value={a.id} />
                  <h3 className="text-sm font-semibold mb-1">반려</h3>
                  <div className="form-row">
                    <label className="label" htmlFor={`note-${a.id}`}>사유</label>
                    <textarea id={`note-${a.id}`} name="review_note" rows={3} maxLength={1000} className="field" placeholder="기록용. 신청자에게는 자동으로 알리지 않습니다." />
                  </div>
                  <SubmitButton className="btn btn-danger btn-sm">반려</SubmitButton>
                </ActionForm>
              </div>
            )}

            {a.status === "approved" && (
              <div className="mt-3 pt-3 border-t border-border">
                <InviteBox a={a} v={a.tenant_id ? vendorById.get(a.tenant_id) : undefined} origin={origin} platformName={platform.platformName} />
              </div>
            )}

            {a.status === "rejected" && (
              <p className="mt-3 pt-3 border-t border-border text-sm">
                <span className="text-xs text-muted mr-2">반려 사유</span>
                {a.review_note || <span className="text-muted">(적지 않음)</span>}
              </p>
            )}
          </div>
        ))}
        {apps.length === 0 && (
          <p className="text-sm text-muted p-4 card">
            {filter === "pending" ? "심사 대기 중인 신청이 없습니다." : "해당하는 신청이 없습니다."} 협력업체 신청은 공개 신청 페이지에서 들어오고, 새 신청이 오면 운영자에게
            앱 알림이 갑니다.
          </p>
        )}
      </div>
    </div>
  );
}
