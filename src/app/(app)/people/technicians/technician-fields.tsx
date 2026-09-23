import type { CodeValue } from "@/lib/codes";
import { phone } from "@/lib/format";
import type { Option } from "../data";
import { CodeCheckboxes, RATE_OPTIONS } from "../shared";

export type TechnicianFormValues = {
  name?: string | null;
  phone?: string | null;
  branch_id?: string | null;
  profile_id?: string | null;
  skills?: string[] | null;
  rate_type?: string | null;
  vehicle_no?: string | null;
  hire_date?: string | null;
  memo?: string | null;
};

/** 시공자 등록·수정 폼의 입력 칸(계좌·상태는 상세 화면이 따로 붙인다). */
export function TechnicianFields({
  v,
  branches,
  skills,
  members,
  linked,
  idPrefix,
}: {
  v: TechnicianFormValues;
  branches: Option[];
  skills: CodeValue[];
  /** 시공기사 역할의 활성 구성원(앱 계정 연결용) */
  members: Option[];
  /** 이미 다른 시공자에 연결된 계정 */
  linked: Set<string>;
  idPrefix: string;
}) {
  const id = (n: string) => `${idPrefix}-${n}`;
  return (
    <>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("name")}>
            이름<span className="req">*</span>
          </label>
          <input id={id("name")} name="name" required maxLength={40} defaultValue={v.name ?? ""} className="field" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("phone")}>전화</label>
          <input id={id("phone")} name="phone" type="tel" maxLength={30} defaultValue={phone(v.phone)} placeholder="010-0000-0000" className="field mono" />
        </div>
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
      <fieldset className="form-row">
        <legend className="label">기술(작업 단위)</legend>
        <CodeCheckboxes name="skills" values={skills} selected={v.skills ?? []} empty="등록된 작업 단위가 없습니다." />
      </fieldset>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("rate")}>정산 방식</label>
          <select id={id("rate")} name="rate_type" defaultValue={v.rate_type ?? "rate_3_3"} className="field">
            {RATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("vehicle")}>차량 번호</label>
          <input id={id("vehicle")} name="vehicle_no" maxLength={20} defaultValue={v.vehicle_no ?? ""} className="field mono" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("hire")}>입사일</label>
          <input id={id("hire")} name="hire_date" type="date" defaultValue={v.hire_date ?? ""} className="field mono" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("profile")}>앱 계정</label>
          <select id={id("profile")} name="profile_id" defaultValue={v.profile_id ?? ""} className="field">
            <option value="">연결 안 함</option>
            {members.map((m) => (
              <option key={m.id} value={m.id} disabled={linked.has(m.id)}>
                {m.name}
                {linked.has(m.id) ? " (다른 시공자에 연결됨)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("memo")}>메모</label>
        <textarea id={id("memo")} name="memo" maxLength={2000} rows={3} defaultValue={v.memo ?? ""} className="field" />
      </div>
    </>
  );
}
