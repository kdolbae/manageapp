import type { Option } from "../data";

export type SiteFormValues = {
  complex_id?: string | null;
  name?: string | null;
  address?: string | null;
  dong?: string | null;
  ho?: string | null;
  unit_type?: string | null;
  move_in_date?: string | null;
  memo?: string | null;
};

/** 현장 추가·수정 폼의 입력 칸. twoCol 이면 넓은 칸(주소·메모)이 두 열을 차지한다. */
export function SiteFields({
  v,
  complexes,
  idPrefix,
  twoCol = false,
}: {
  v: SiteFormValues;
  complexes: Option[];
  idPrefix: string;
  twoCol?: boolean;
}) {
  const id = (n: string) => `${idPrefix}-${n}`;
  const wide = twoCol ? " sm:col-span-2" : "";
  return (
    <>
      <div className="form-row">
        <label className="label" htmlFor={id("complex")}>아파트 단지</label>
        <select id={id("complex")} name="complex_id" defaultValue={v.complex_id ?? ""} className="field">
          <option value="">직접 입력</option>
          {complexes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("name")}>
          현장 이름<span className="req">*</span>
        </label>
        <input id={id("name")} name="name" maxLength={80} defaultValue={v.name ?? ""} placeholder="단지를 고르면 비워도 됩니다" className="field" />
      </div>
      <div className={"form-row" + wide}>
        <label className="label" htmlFor={id("address")}>주소</label>
        <input id={id("address")} name="address" maxLength={200} defaultValue={v.address ?? ""} className="field" />
      </div>
      <div className="grid grid-cols-3 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={id("dong")}>동</label>
          <input id={id("dong")} name="dong" maxLength={20} defaultValue={v.dong ?? ""} className="field mono" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("ho")}>호</label>
          <input id={id("ho")} name="ho" maxLength={20} defaultValue={v.ho ?? ""} className="field mono" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("unit")}>평형/타입</label>
          <input id={id("unit")} name="unit_type" maxLength={30} defaultValue={v.unit_type ?? ""} placeholder="예: 84A" className="field" />
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("movein")}>입주일</label>
        <input id={id("movein")} name="move_in_date" type="date" defaultValue={v.move_in_date ?? ""} className="field mono" />
      </div>
      <div className={"form-row" + wide}>
        <label className="label" htmlFor={id("memo")}>메모</label>
        <textarea id={id("memo")} name="memo" maxLength={2000} rows={2} defaultValue={v.memo ?? ""} className="field" />
      </div>
    </>
  );
}
