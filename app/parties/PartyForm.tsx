import Link from "next/link";

type PartyDefaults = {
  id?: string;
  type?: string;
  name?: string;
  regNo?: string | null;
  address?: string | null;
};

export function PartyForm({
  action,
  party,
}: {
  action: (formData: FormData) => void;
  party?: PartyDefaults;
}) {
  return (
    <form action={action}>
      <div className="grid cols-2">
        <label className="field">
          <span>구분</span>
          <select name="type" defaultValue={party?.type ?? "COMPANY"}>
            <option value="COMPANY">법인</option>
            <option value="INDIVIDUAL">개인</option>
          </select>
        </label>
        <label className="field">
          <span>거래처명 *</span>
          <input name="name" required defaultValue={party?.name ?? ""} />
        </label>
        <label className="field">
          <span>사업자/식별번호</span>
          <input name="regNo" defaultValue={party?.regNo ?? ""} />
        </label>
        <label className="field">
          <span>주소</span>
          <input name="address" defaultValue={party?.address ?? ""} />
        </label>
      </div>
      <div className="toolbar">
        <button className="btn primary" type="submit">
          저장
        </button>
        <Link className="btn" href={party?.id ? `/parties/${party.id}` : "/parties"}>
          취소
        </Link>
      </div>
    </form>
  );
}
