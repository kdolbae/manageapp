import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { updateTenant } from "@/lib/actions/settings";

export const metadata = { title: "사업체 설정" };

export default async function TenantSettingsPage() {
  const session = await requireTenant();
  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenant")
    .select("id, name, slug, business_no, brand, created_at")
    .eq("id", session.current.tenant_id)
    .single();
  const brand = (tenant?.brand ?? {}) as Record<string, string | null>;
  const editable = session.can("tenant.manage");

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
          <p className="text-xs text-muted mb-3">고객이 알림톡 링크로 여는 페이지에 이 이름·색·연락처가 보입니다.</p>
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
          {editable && <SubmitButton>저장</SubmitButton>}
        </fieldset>
      </ActionForm>
      {!editable && <p className="text-xs text-muted mt-2">사업체 설정은 대표만 바꿀 수 있습니다.</p>}
    </div>
  );
}
