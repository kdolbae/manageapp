import type { CodeValue } from "@/lib/codes";
import { phone } from "@/lib/format";
import type { Option } from "../data";

export type CustomerFormValues = {
  name?: string | null;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  address?: string | null;
  source_code?: string | null;
  referrer_partner_id?: string | null;
  branch_id?: string | null;
  owner_id?: string | null;
  marketing_consent?: boolean;
  memo?: string | null;
};

/** 고객 등록·수정 폼의 입력 칸(두 화면이 같이 쓴다). */
export function CustomerFields({
  v,
  sources,
  partners,
  branches,
  members,
  owner,
  idPrefix,
}: {
  v: CustomerFormValues;
  sources: CodeValue[];
  partners: Option[];
  branches: Option[];
  members: Option[];
  /** 본인 범위(own) 사용자는 담당자를 고를 수 없어 본인으로 고정한다. */
  owner: { id: string; name: string; locked: boolean };
  idPrefix: string;
}) {
  const id = (n: string) => `${idPrefix}-${n}`;
  return (
    <>
      <div className="form-row">
        <label className="label" htmlFor={id("name")}>
          이름<span className="req">*</span>
        </label>
        <input id={id("name")} name="name" required maxLength={40} defaultValue={v.name ?? ""} className="field" />
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("phone")}>전화</label>
          <input id={id("phone")} name="phone" type="tel" maxLength={30} defaultValue={phone(v.phone)} placeholder="010-0000-0000" className="field mono" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("phone2")}>전화 2</label>
          <input id={id("phone2")} name="phone2" type="tel" maxLength={30} defaultValue={phone(v.phone2)} className="field mono" />
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("email")}>이메일</label>
        <input id={id("email")} name="email" type="email" maxLength={120} defaultValue={v.email ?? ""} className="field" />
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("address")}>주소</label>
        <input id={id("address")} name="address" maxLength={200} defaultValue={v.address ?? ""} className="field" />
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("source")}>유입 경로</label>
          <select id={id("source")} name="source_code" defaultValue={v.source_code ?? ""} className="field">
            <option value="">선택 안 함</option>
            {sources.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("referrer")}>소개처</label>
          <select id={id("referrer")} name="referrer_partner_id" defaultValue={v.referrer_partner_id ?? ""} className="field">
            <option value="">없음</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("branch")}>지점</label>
          <select id={id("branch")} name="branch_id" defaultValue={v.branch_id ?? ""} className="field">
            <option value="">지점 없음(본사 공통)</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("owner")}>담당자</label>
          {owner.locked ? (
            <>
              <input type="hidden" name="owner_id" value={owner.id} />
              <input id={id("owner")} value={owner.name} readOnly className="field text-muted" />
            </>
          ) : (
            <select id={id("owner")} name="owner_id" defaultValue={v.owner_id ?? ""} className="field">
              <option value="">담당자 없음</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <label className="form-row flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" name="marketing_consent" defaultChecked={v.marketing_consent ?? false} />
        마케팅 수신 동의
      </label>
      <div className="form-row">
        <label className="label" htmlFor={id("memo")}>메모</label>
        <textarea id={id("memo")} name="memo" maxLength={2000} rows={3} defaultValue={v.memo ?? ""} className="field" />
      </div>
    </>
  );
}
