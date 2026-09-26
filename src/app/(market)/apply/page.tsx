import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { REGIONS, platformCategories } from "@/lib/market";
import { applyVendor } from "@/lib/actions/market-public";
import { SubmitButton } from "@/components/action-form";
import { SuccessForm } from "../_components/success-form";

export const metadata: Metadata = {
  title: "협력업체 신청",
  description: "집대리 협력업체로 등록하면 계약·시공 관리를 무료로 쓰고, 지역·분류에 맞는 고객 견적 요청을 받습니다.",
};

// 서비스 분류표를 요청 시점에 읽는다 (빌드 시 정적 생성 금지)
export const dynamic = "force-dynamic";

const BENEFITS = [
  { title: "무료 계약·시공 관리", body: "계약서, 일정, 기사 배정, 시공 사진까지 집대리 관리 프로그램을 그대로 무료로 씁니다." },
  { title: "견적 요청 알림", body: "내 지역·분류에 맞는 고객 요청이 들어오면 바로 알려드립니다. 견적을 내고 대화로 일정을 잡으세요." },
  { title: "후기·사진 노출", body: "시공 후기와 사진이 업체 소개 페이지에 쌓여 고객에게 보입니다. 상단 노출 광고도 신청할 수 있습니다." },
];

export default async function ApplyPage() {
  const admin = createAdminClient();
  const cats = admin ? await platformCategories(admin) : [];

  const success = (
    <section className="card p-5">
      <h2 className="text-lg font-bold">신청을 받았습니다</h2>
      <p className="text-sm mt-1">심사 후 이메일로 초대 링크를 보내드립니다. 초대 링크로 가입하면 바로 계약·시공 관리를 시작할 수 있고, 운영자가 노출을 켜면 업체 소개가 고객에게 보입니다.</p>
      <div className="flex gap-2 mt-4"><Link href="/vendors" className="btn">업체 둘러보기</Link></div>
    </section>
  );

  return (
    <>
      <section className="card p-5">
        <h1 className="text-xl font-bold leading-snug">집대리 협력업체 신청</h1>
        <p className="text-sm text-muted mt-1">입주 청소·코팅·줄눈·필름·블라인드 등 입주 시공 업체를 모십니다. 신청 후 심사를 거쳐 등록됩니다.</p>
        <ul className="grid gap-2 mt-4 sm:grid-cols-3">
          {BENEFITS.map((b) => (
            <li key={b.title} className="rounded border border-border bg-bg p-3">
              <p className="text-sm font-semibold">{b.title}</p>
              <p className="text-xs text-muted mt-1">{b.body}</p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted mt-3">수수료는 집대리를 통해 계약이 성사됐을 때만, 업체별 약정(건당 정액 또는 계약금액의 일정 %)으로 월말에 정산합니다.</p>
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold mb-1">신청서</h2>
        {!admin && <p className="notice notice-danger mb-3">지금은 신청을 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요.</p>}
        <SuccessForm action={applyVendor} success={success}>
          <input type="text" name="website_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row col-span-2 sm:col-span-1"><label className="label" htmlFor="name">상호<span className="req">*</span></label><input id="name" name="name" required maxLength={60} className="field" /></div>
            <div className="form-row"><label className="label" htmlFor="business_no">사업자번호</label><input id="business_no" name="business_no" maxLength={20} inputMode="numeric" placeholder="000-00-00000" className="field mono" /></div>
            <div className="form-row"><label className="label" htmlFor="ceo_name">대표자</label><input id="ceo_name" name="ceo_name" maxLength={40} className="field" /></div>
            <div className="form-row"><label className="label" htmlFor="phone">전화<span className="req">*</span></label><input id="phone" name="phone" type="tel" required maxLength={30} inputMode="tel" className="field mono" /></div>
            <div className="form-row"><label className="label" htmlFor="email">이메일<span className="req">*</span></label><input id="email" name="email" type="email" required maxLength={120} className="field" /></div>
          </div>
          <p className="text-xs text-muted -mt-1 mb-3">승인되면 이 이메일로 대표 계정 초대 링크를 보냅니다.</p>
          <div className="form-row"><label className="label" htmlFor="address">주소</label><input id="address" name="address" maxLength={200} className="field" /></div>

          <div className="form-row">
            <span className="label">시공 지역</span>
            <div className="flex flex-wrap gap-1.5">
              {REGIONS.map((r) => (
                <label key={r} className="chip"><input type="checkbox" name="regions" value={r} /> {r}</label>
              ))}
            </div>
            <p className="text-xs text-muted mt-1">고르지 않으면 전국으로 표시됩니다.</p>
          </div>

          <div className="form-row">
            <span className="label">서비스 분류<span className="req">*</span></span>
            {cats.length === 0 ? (
              <p className="text-xs text-muted">분류표를 불러오지 못했습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <label key={c.code} className="chip"><input type="checkbox" name="categories" value={c.code} /> {c.label}</label>
                ))}
              </div>
            )}
          </div>

          <div className="form-row"><label className="label" htmlFor="intro">소개</label><textarea id="intro" name="intro" rows={5} maxLength={1000} placeholder="주요 시공, 경력, 강점(당일 견적, 보증 기간 등)을 적어 주세요. 업체 소개 페이지에 그대로 실립니다." className="field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-row col-span-2 sm:col-span-1"><label className="label" htmlFor="website">홈페이지</label><input id="website" name="website" type="url" maxLength={200} placeholder="https://" className="field" /></div>
            <div className="form-row col-span-2 sm:col-span-1"><label className="label" htmlFor="slug_wanted">원하는 주소 이름</label><input id="slug_wanted" name="slug_wanted" maxLength={31} pattern="[a-z0-9][a-z0-9\-]{1,30}" placeholder="cleanhouse" className="field mono" /></div>
          </div>
          <p className="text-xs text-muted -mt-1 mb-3">영문 소문자·숫자·하이픈. 승인되면 업체 소개 주소가 <span className="mono">/vendors/이름</span> 이 됩니다. 비워 두면 운영자가 정합니다.</p>
          <SubmitButton className="btn btn-primary btn-lg w-full">협력업체 신청</SubmitButton>
        </SuccessForm>
      </section>
    </>
  );
}
