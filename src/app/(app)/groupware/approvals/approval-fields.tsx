import { APPROVAL_KIND } from "@/lib/groupware";
import type { Option } from "@/app/(app)/people/data";

export type ApprovalValues = { kind: string; title: string; body: string | null; amount: number | string | null; approvers: (string | null)[] };

export const EMPTY_APPROVAL: ApprovalValues = { kind: "general", title: "", body: null, amount: null, approvers: [] };

/** 결재 올리기·수정 공용 입력란. ActionForm 안에서 쓴다. members 는 본인을 뺀 활성 구성원. */
export function ApprovalFields({ values, members, idPrefix }: { values: ApprovalValues; members: Option[]; idPrefix: string }) {
  const id = (n: string) => `${idPrefix}-${n}`;
  return (
    <>
      <div className="grid gap-x-3 sm:grid-cols-[180px_1fr]">
        <div className="form-row">
          <label className="label" htmlFor={id("kind")}>종류</label>
          <select id={id("kind")} name="kind" defaultValue={values.kind} className="field">
            {Object.entries(APPROVAL_KIND).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("title")}>제목<span className="req">*</span></label>
          <input id={id("title")} name="title" required maxLength={120} defaultValue={values.title} className="field" />
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("body")}>내용</label>
        <textarea id={id("body")} name="body" rows={8} maxLength={10000} defaultValue={values.body ?? ""} className="field" placeholder="사유, 품목, 일정 등" />
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("amount")}>금액(원) <span className="text-muted">(해당될 때)</span></label>
        <input id={id("amount")} name="amount" inputMode="numeric" defaultValue={values.amount === null || values.amount === undefined ? "" : String(values.amount)} placeholder="0" className="field num w-full max-w-[220px]" />
      </div>
      <div className="form-row">
        <span className="label">결재선 <span className="text-muted">(1 → 2 → 3 순서로 결재, 빈 칸은 건너뜀)</span></span>
        <div className="grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <select key={i} id={id(`approver-${i + 1}`)} name={`approver_${i + 1}`} defaultValue={values.approvers[i] ?? ""} className="field" aria-label={`${i + 1}단계 결재자`}>
              <option value="">{i + 1}단계 없음</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ))}
        </div>
      </div>
    </>
  );
}
