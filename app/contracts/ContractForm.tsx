import Link from "next/link";
import { formatDate, toNumber } from "@/lib/format";

type PartyOption = { id: string; name: string };

type ContractDefaults = {
  id?: string;
  code?: string;
  title?: string;
  counterpartyId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  autoRenew?: boolean;
  noticePeriodDays?: number | null;
  currency?: string;
  totalAmount?: unknown;
};

export function ContractForm({
  parties,
  action,
  contract,
  isNew,
}: {
  parties: PartyOption[];
  action: (formData: FormData) => void;
  contract?: ContractDefaults;
  isNew?: boolean;
}) {
  return (
    <form action={action}>
      <div className="grid cols-2">
        {isNew && (
          <label className="field">
            <span>계약번호 (비우면 자동 생성)</span>
            <input name="code" placeholder="CT-2026-0001" />
          </label>
        )}
        <label className="field">
          <span>계약명 *</span>
          <input name="title" required defaultValue={contract?.title ?? ""} />
        </label>
        <label className="field">
          <span>거래처</span>
          <select name="counterpartyId" defaultValue={contract?.counterpartyId ?? ""}>
            <option value="">선택 안 함</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {isNew && (
          <label className="field">
            <span>초기 상태</span>
            <select name="status" defaultValue="DRAFT">
              <option value="DRAFT">초안</option>
              <option value="REVIEW">검토</option>
              <option value="SIGNED">체결</option>
              <option value="ACTIVE">이행중</option>
            </select>
          </label>
        )}
        <label className="field">
          <span>시작일</span>
          <input type="date" name="startDate" defaultValue={formatDateInput(contract?.startDate)} />
        </label>
        <label className="field">
          <span>종료일</span>
          <input type="date" name="endDate" defaultValue={formatDateInput(contract?.endDate)} />
        </label>
        <label className="field">
          <span>통화</span>
          <input name="currency" defaultValue={contract?.currency ?? "KRW"} />
        </label>
        <label className="field">
          <span>총액</span>
          <input
            name="totalAmount"
            type="number"
            step="0.01"
            defaultValue={contract?.totalAmount ? toNumber(contract.totalAmount as any) : ""}
          />
        </label>
        <label className="field">
          <span>갱신 통지 기한(일)</span>
          <input
            name="noticePeriodDays"
            type="number"
            defaultValue={contract?.noticePeriodDays ?? ""}
          />
        </label>
        <label className="field" style={{ alignSelf: "end" }}>
          <span>자동 갱신</span>
          <input
            type="checkbox"
            name="autoRenew"
            defaultChecked={contract?.autoRenew ?? false}
            style={{ width: "auto" }}
          />
        </label>
      </div>

      <div className="toolbar">
        <button className="btn primary" type="submit">
          저장
        </button>
        <Link className="btn" href={contract?.id ? `/contracts/${contract.id}` : "/contracts"}>
          취소
        </Link>
      </div>
    </form>
  );
}

function formatDateInput(d: Date | null | undefined): string {
  return d ? formatDate(d) : "";
}
