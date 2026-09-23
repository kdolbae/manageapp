import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { REGIONS, platformCategories } from "@/lib/market";
import { vendorBySlug } from "@/lib/market-public";
import { createRequest } from "@/lib/actions/market-public";
import { ActionForm, SubmitButton } from "@/components/action-form";

export const metadata: Metadata = {
  title: "견적 요청",
  description: "입주 시공 조건을 남기면 여러 업체의 견적을 한 페이지에서 비교하고 대화로 일정을 정할 수 있습니다.",
};

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

export default async function RequestPage({ searchParams }: PageProps<"/request">) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const admin = createAdminClient();
  const wantedSlug = pick("vendor");
  const cats = admin ? await platformCategories(admin) : [];
  const vendor = admin && wantedSlug ? await vendorBySlug(admin, wantedSlug) : null;
  const sourcePage = vendor ? `/request?vendor=${vendor.slug}` : "/request";
  const defaultRegion = vendor?.regions.find((r) => (REGIONS as readonly string[]).includes(r)) ?? "";

  return (
    <>
      <section className="card p-5">
        <h1 className="text-xl font-bold leading-snug">{vendor ? `${vendor.name}에게 보내는 요청` : "입주 시공 견적 요청"}</h1>
        {vendor ? (
          <p className="text-sm text-muted mt-1">이 요청은 {vendor.name}에게만 갑니다. 여러 업체 견적을 비교하려면 <Link href="/request">전체 업체에 요청</Link>하세요.</p>
        ) : (
          <p className="text-sm text-muted mt-1">조건에 맞는 업체들에게 보냅니다. 견적이 오면 한 페이지에서 비교하고, 마음에 드는 업체와 대화로 일정을 정하세요.</p>
        )}
        {wantedSlug && !vendor && <p className="notice mt-3">찾는 업체가 없거나 지금은 노출되지 않아, 조건에 맞는 전체 업체에게 보냅니다.</p>}
        <p className="notice mt-3">전화번호는 업체에 보이지 않습니다. 진행할 업체를 선택한 뒤 공개를 켤 때만 그 업체에 보입니다. 동·호수도 선택한 업체에게만 보입니다.</p>
      </section>

      <section className="card p-4">
        {!admin && <p className="notice notice-danger mb-3">지금은 요청을 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요.</p>}
        <ActionForm action={createRequest}>
          {vendor && <input type="hidden" name="vendor_slug" value={vendor.slug} />}
          {UTM_KEYS.map((k) => pick(k) && <input key={k} type="hidden" name={k} value={pick(k)} />)}
          <input type="hidden" name="source_page" value={sourcePage} />
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

          <div className="grid grid-cols-2 gap-3">
            <div className="form-row"><label className="label" htmlFor="name">이름<span className="req">*</span></label><input id="name" name="name" required maxLength={60} className="field" /></div>
            <div className="form-row"><label className="label" htmlFor="phone">전화<span className="req">*</span></label><input id="phone" name="phone" type="tel" required maxLength={30} inputMode="tel" className="field mono" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row">
              <label className="label" htmlFor="region_main">지역<span className="req">*</span></label>
              <select id="region_main" name="region_main" required defaultValue={defaultRegion} className="field">
                <option value="" disabled>선택</option>
                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="form-row"><label className="label" htmlFor="region_detail">시·군·구</label><input id="region_detail" name="region_detail" maxLength={40} placeholder="예: 수성구" className="field" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row"><label className="label" htmlFor="apt">아파트·단지</label><input id="apt" name="apt" maxLength={100} className="field" /></div>
            <div className="form-row"><label className="label" htmlFor="address">동·호수</label><input id="address" name="address" maxLength={200} placeholder="선택한 업체에게만 보입니다" className="field" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row"><label className="label" htmlFor="area_pyeong">평형</label><input id="area_pyeong" name="area_pyeong" type="number" min={1} max={999} inputMode="numeric" className="field num" /></div>
            <div className="form-row"><label className="label" htmlFor="move_in_date">입주 예정일</label><input id="move_in_date" name="move_in_date" type="date" className="field" /></div>
          </div>

          <div className="form-row">
            <span className="label">원하는 시공<span className="req">*</span></span>
            {cats.length === 0 ? (
              <p className="text-xs text-muted">분류표를 불러오지 못했습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <label key={c.code} className="chip"><input type="checkbox" name="categories" value={c.code} defaultChecked={vendor?.categories.includes(c.code) ?? false} /> {c.label}</label>
                ))}
              </div>
            )}
          </div>

          <div className="form-row"><label className="label" htmlFor="message">요청 내용</label><textarea id="message" name="message" rows={4} maxLength={2000} placeholder="원하시는 시공 범위(주방 코팅, 욕실 줄눈 등), 희망 일정, 참고 사항을 적어 주세요" className="field" /></div>
          <div className="form-row"><label className="label" htmlFor="budget">예산 (원, 선택)</label><input id="budget" name="budget" type="number" min={0} step={10000} inputMode="numeric" className="field num" /></div>

          <p className="text-xs text-muted mb-3">요청을 보내면 견적을 모아 보는 비밀 링크가 만들어집니다. 그 주소를 저장해 두면 언제든 다시 열 수 있습니다.</p>
          <SubmitButton className="btn btn-primary btn-lg w-full">{vendor ? `${vendor.name}에게 견적 요청` : "견적 요청 보내기"}</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
