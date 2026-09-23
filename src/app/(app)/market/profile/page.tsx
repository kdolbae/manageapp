import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { ymdKST } from "@/lib/groupware";
import { REGIONS, categoryLabels, platformCategories } from "@/lib/market";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { upsertVendorProfile } from "@/lib/actions/market";
import { myVendorProfile } from "../data";

export const metadata = { title: "업체 소개" };

export default async function VendorProfilePage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const slug = session.current.tenant.slug;
  const canWrite = session.can("market.write");
  const supabase = await createClient();
  const [profile, cats] = await Promise.all([myVendorProfile(supabase, tid), platformCategories(supabase, false)]);
  const selected = new Set(profile?.categories ?? []);
  // 중지된 분류는 이미 골라 둔 것만 보여 준다 (저장할 때 조용히 빠지지 않게)
  const catOptions = cats.filter((c) => c.is_active || selected.has(c.code));
  const regions = profile?.regions ?? [];
  const brand = (session.current.tenant.brand ?? {}) as Record<string, unknown>;
  const tagline = typeof brand.tagline === "string" ? brand.tagline : "";

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px] items-start">
      <div className="grid gap-4">
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">노출 상태</h2>
            {profile?.is_listed ? <span className="badge badge-done">노출 중</span> : <span className="badge badge-wait">노출 대기</span>}
          </div>
          <p className="text-sm mt-2">
            {profile?.is_listed ? (
              <>
                노출 중{profile.listed_at && <> · {ymdKST(profile.listed_at)}부터</>}. 공개 페이지:{" "}
                <a href={`/vendors/${slug}`} target="_blank" rel="noreferrer" className="mono">/vendors/{slug}</a>
              </>
            ) : profile ? (
              "노출 대기 — 집대리 운영자가 확인 후 켭니다. 켜지면 분류·지역이 맞는 견적 요청이 오고 구성원에게 알림이 갑니다."
            ) : (
              "아직 업체 소개가 없습니다. 아래에서 등록하면 집대리 운영자가 확인한 뒤 노출을 켭니다."
            )}
          </p>
        </div>

        {canWrite ? (
          <ActionForm action={upsertVendorProfile} className="card p-4">
            <h2 className="text-sm font-semibold mb-1">업체 소개 {profile ? "수정" : "등록"}</h2>
            <p className="text-xs text-muted mb-3">고객이 견적을 비교할 때 보는 정보입니다. 분류·지역은 어떤 요청이 우리에게 오는지도 정합니다.</p>
            <div className="form-row">
              <span className="label">서비스 분류<span className="req">*</span></span>
              <div className="flex flex-wrap gap-1.5">
                {catOptions.map((c) => (
                  <label key={c.code} className="chip">
                    <input type="checkbox" name="categories" value={c.code} defaultChecked={selected.has(c.code)} /> {c.label}
                    {!c.is_active && <span className="text-muted">(중지)</span>}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-row">
              <span className="label">시공 지역 — 아무것도 고르지 않으면 전국</span>
              <div className="flex flex-wrap gap-1.5">
                {REGIONS.map((g) => (
                  <label key={g} className="chip">
                    <input type="checkbox" name="regions" value={g} defaultChecked={regions.includes(g)} /> {g}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label className="label" htmlFor="vp-intro">소개</label>
              <textarea id="vp-intro" name="intro" rows={5} maxLength={1000} defaultValue={profile?.intro ?? ""} placeholder="어떤 시공을 얼마나 해 왔는지, 무엇이 다른지" className="field" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="vp-highlights">강점 — 한 줄에 하나, 최대 6줄</label>
              <textarea id="vp-highlights" name="highlights" rows={4} maxLength={400} defaultValue={(profile?.highlights ?? []).join("\n")} placeholder={"당일 견적\n10년 경력\n무료 AS 1년"} className="field" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
              <div className="form-row">
                <label className="label" htmlFor="vp-min">최소 금액(원)</label>
                <input id="vp-min" name="min_price" inputMode="numeric" defaultValue={profile?.min_price ?? ""} placeholder="150000" className="field num" />
              </div>
              <div className="form-row">
                <label className="label" htmlFor="vp-note">응답 안내</label>
                <input id="vp-note" name="response_note" maxLength={120} defaultValue={profile?.response_note ?? ""} placeholder="평일 1시간 안에 답변" className="field" />
              </div>
            </div>
            <SubmitButton>{profile ? "저장" : "등록하고 노출 요청"}</SubmitButton>
          </ActionForm>
        ) : (
          <div className="card p-4 text-sm text-muted">업체 소개를 편집하려면 견적 제출 권한(market.write)이 필요합니다.</div>
        )}
      </div>

      <div className="grid gap-4">
        <div className="card">
          <div className="panel-head">
            <h2>
              고객에게 보이는 카드 <span className="sub">미리보기</span>
            </h2>
          </div>
          <div className="p-4">
            <div className="text-base font-semibold">{session.current.tenant.name}</div>
            {tagline && <div className="text-xs text-muted">{tagline}</div>}
            <div className="text-xs text-muted mt-1">
              {categoryLabels(profile?.categories, cats) || "분류 없음"} · {regions.length ? regions.join(", ") : "전국"}
            </div>
            {(profile?.highlights ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(profile?.highlights ?? []).map((h, i) => (
                  <span key={i} className="chip">{h}</span>
                ))}
              </div>
            )}
            <p className="text-sm mt-3 whitespace-pre-wrap leading-relaxed">{profile?.intro || <span className="text-muted">소개가 없습니다.</span>}</p>
            <div className="text-xs text-muted mt-3 flex flex-wrap gap-x-3">
              {profile?.min_price != null && <span>최소 {won(profile.min_price)}원부터</span>}
              {profile?.response_note && <span>{profile.response_note}</span>}
            </div>
            <p className="text-xs text-muted mt-3">평점·후기 수·완료 시공 수는 승인된 후기와 완료된 시공 건에서 자동으로 계산돼 붙습니다.</p>
          </div>
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">사진·후기는 어디서 오나</h2>
          <p className="text-xs text-muted">
            공개 페이지의 시공 사진은 <Link href="/content">사진·후기·콘텐츠</Link>에서 &lsquo;마케팅 사용&rsquo;을 켠 사진이, 후기는 <Link href="/content/reviews">후기</Link>에서 승인한 것만 자동으로 나옵니다. 여기서 따로 올리지 않습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
