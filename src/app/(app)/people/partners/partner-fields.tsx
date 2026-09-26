import type { CodeValue } from "@/lib/codes";
import { phone } from "@/lib/format";
import type { Option } from "../data";
import { CodeCheckboxes } from "../shared";

export type PartnerFormValues = {
  name?: string | null;
  types?: string[] | null;
  business_no?: string | null;
  ceo_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  commission_rate?: number | string | null;
  settlement_terms?: string | null;
  memo?: string | null;
  branch_id?: string | null;
};

/** 협력업체 등록·수정 폼의 입력 칸(상태는 상세 화면이 따로 붙인다). */
export function PartnerFields({
  v,
  types,
  branches,
  idPrefix,
}: {
  v: PartnerFormValues;
  types: CodeValue[];
  branches: Option[];
  idPrefix: string;
}) {
  const id = (n: string) => `${idPrefix}-${n}`;
  return (
    <>
      <div className="form-row">
        <label className="label" htmlFor={id("name")}>
          업체명<span className="req">*</span>
        </label>
        <input id={id("name")} name="name" required maxLength={80} defaultValue={v.name ?? ""} className="field" />
      </div>
      <fieldset className="form-row">
        <legend className="label">유형</legend>
        <CodeCheckboxes name="types" values={types} selected={v.types ?? []} empty="등록된 협력업체 유형이 없습니다." />
      </fieldset>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("bizno")}>사업자번호</label>
          <input id={id("bizno")} name="business_no" maxLength={20} defaultValue={v.business_no ?? ""} placeholder="000-00-00000" className="field mono" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("ceo")}>대표자</label>
          <input id={id("ceo")} name="ceo_name" maxLength={40} defaultValue={v.ceo_name ?? ""} className="field" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("phone")}>대표 전화</label>
          <input id={id("phone")} name="phone" type="tel" maxLength={30} defaultValue={phone(v.phone)} className="field mono" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("email")}>이메일</label>
          <input id={id("email")} name="email" type="email" maxLength={120} defaultValue={v.email ?? ""} className="field" />
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("address")}>주소</label>
        <input id={id("address")} name="address" maxLength={200} defaultValue={v.address ?? ""} className="field" />
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("contact")}>담당자</label>
          <input id={id("contact")} name="contact_name" maxLength={40} defaultValue={v.contact_name ?? ""} className="field" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("cphone")}>담당자 연락처</label>
          <input id={id("cphone")} name="contact_phone" type="tel" maxLength={30} defaultValue={phone(v.contact_phone)} className="field mono" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("rate")}>수수료율 (%)</label>
          <input
            id={id("rate")}
            name="commission_rate"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.001}
            defaultValue={v.commission_rate ?? ""}
            className="field mono"
          />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("branch")}>지점</label>
          <select id={id("branch")} name="branch_id" defaultValue={v.branch_id ?? ""} className="field">
            <option value="">지점 없음(본사 공통)</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("terms")}>정산 조건</label>
        <input id={id("terms")} name="settlement_terms" maxLength={500} defaultValue={v.settlement_terms ?? ""} placeholder="예: 월말 마감, 익월 10일 지급" className="field" />
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("memo")}>메모</label>
        <textarea id={id("memo")} name="memo" maxLength={2000} rows={3} defaultValue={v.memo ?? ""} className="field" />
      </div>
    </>
  );
}
