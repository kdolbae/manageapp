import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { updateTenant } from "@/lib/actions/settings";
import { CopyButton } from "@/components/copy-button";
import { siteOrigin } from "@/lib/origin";

export const metadata = { title: "사업체 설정" };

export default async function TenantSettingsPage() {
  const session = await requireTenant();
  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenant")
    .select("id, name, slug, business_no, brand, settings, created_at")
    .eq("id", session.current.tenant_id)
    .single();
  const brand = (tenant?.brand ?? {}) as Record<string, string | null>;
  const settings = (tenant?.settings ?? {}) as Record<string, string | null>;
  const editable = session.can("tenant.manage");
  const brandUrl = `${await siteOrigin()}/c/${tenant?.slug ?? ""}`;

  return (
    <div className="max-w-[560px]">
      <ActionForm action={updateTenant} className="card p-4">
        <fieldset disabled={!editable} className="contents">
          <div className="form-row">
            <label className="label" htmlFor="name">사업체 이름<span className="req">*</span></label>
            <input id="name" name="name" defaultValue={tenant?.name ?? ""} required maxLength={60} className="field" />
          </div>
          <div className="form-row">
            <label className="label">주소 이름</label>
            <div className="field mono flex items-center bg-bg text-muted">{tenant?.slug}</div>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="business_no">사업자등록번호</label>
            <input id="business_no" name="business_no" defaultValue={tenant?.business_no ?? ""} maxLength={20} className="field mono" />
          </div>
          <h2 className="text-sm font-semibold mt-5 mb-2">고객 페이지 브랜드</h2>
          <p className="text-xs text-muted mb-2">고객이 여는 브랜드 페이지와 계약 링크 페이지에 이 이름·색·연락처가 보입니다. 승인한 후기와 마케팅 사용 사진이 자동으로 실립니다.</p>
          <div className="flex items-center gap-1.5 mb-3"><span className="field mono text-xs flex items-center bg-bg text-muted break-all">{brandUrl}</span><CopyButton text={brandUrl} label="주소 복사" /><a href={brandUrl} target="_blank" rel="noreferrer" className="btn btn-sm">열기</a></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row">
              <label className="label" htmlFor="app_name">브랜드 이름</label>
              <input id="app_name" name="app_name" defaultValue={brand.app_name ?? ""} maxLength={30} placeholder="예: 집대리" className="field" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="color">브랜드 색 (#RRGGBB)</label>
              <input id="color" name="color" defaultValue={brand.color ?? ""} pattern="#[0-9a-fA-F]{6}" placeholder="#1C5FD0" className="field mono" />
            </div>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="phone">고객 문의 전화</label>
            <input id="phone" name="phone" defaultValue={brand.phone ?? ""} maxLength={30} className="field mono" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="tagline">브랜드 페이지 첫 문장</label>
            <input id="tagline" name="tagline" defaultValue={brand.tagline ?? ""} maxLength={80} placeholder="예: 입주 전 코팅·줄눈, 하루 만에 끝" className="field" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="address">주소 (페이지 하단)</label>
            <input id="address" name="address" defaultValue={brand.address ?? ""} maxLength={120} className="field" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row">
              <label className="label" htmlFor="kakao_url">카카오톡 채널 링크</label>
              <input id="kakao_url" name="kakao_url" type="url" defaultValue={brand.kakao_url ?? ""} placeholder="https://pf.kakao.com/..." className="field mono text-xs" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="instagram_url">인스타그램 링크</label>
              <input id="instagram_url" name="instagram_url" type="url" defaultValue={brand.instagram_url ?? ""} placeholder="https://instagram.com/..." className="field mono text-xs" />
            </div>
          </div>
          <h2 className="text-sm font-semibold mt-5 mb-2">계약 약관 (전자서명 화면에 표시)</h2>
          <p className="text-xs text-muted mb-2">고객이 태블릿이나 계약 링크에서 서명할 때 보는 약관입니다. 비워 두면 기본 문구를 씁니다. 법무 검토 후 사업체에 맞게 고쳐 쓰세요.</p>
          <div className="form-row">
            <label className="label" htmlFor="contract_terms">약관 본문</label>
            <textarea id="contract_terms" name="contract_terms" rows={10} maxLength={6000} className="field text-[13px]" defaultValue={settings.contract_terms ?? ""} placeholder="비워 두면 기본 약관(제1조~제7조) 문구가 쓰입니다" />
          </div>
          {editable && <SubmitButton>저장</SubmitButton>}
        </fieldset>
      </ActionForm>
      {!editable && <p className="text-xs text-muted mt-2">사업체 설정은 대표만 바꿀 수 있습니다.</p>}
    </div>
  );
}
