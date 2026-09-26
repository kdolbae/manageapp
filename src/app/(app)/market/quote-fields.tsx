import type { MyQuote } from "./data";

export const QUOTE_ITEM_ROWS = 5;

/** 견적 폼 공용 입력칸(제출·수정). 서버 컴포넌트 — 상태 없이 defaultValue 만 채운다. 품목을 적으면 서버가 합계를 견적 금액으로 삼는다. */
export function QuoteFields({ quote, idPrefix }: { quote?: MyQuote | null; idPrefix: string }) {
  const items = quote?.items ?? [];
  const rows = Array.from({ length: QUOTE_ITEM_ROWS }, (_, i) => items[i]);
  return (
    <>
      <div className="form-row">
        <span className="label">품목 (선택) — 적으면 합계가 견적 금액이 됩니다</span>
        <div className="grid grid-cols-[1fr_64px_120px] gap-1.5 text-[11px] text-muted mb-1">
          <span>이름</span>
          <span className="text-right">수량</span>
          <span className="text-right">단가(원)</span>
        </div>
        {rows.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_64px_120px] gap-1.5 mb-1.5">
            <input name={`item_name_${i + 1}`} defaultValue={it?.name ?? ""} maxLength={60} placeholder={i === 0 ? "예: 주방 나노코팅" : ""} className="field" aria-label={`품목 ${i + 1} 이름`} />
            <input name={`item_qty_${i + 1}`} defaultValue={it ? String(it.qty) : ""} inputMode="decimal" placeholder="1" className="field num" aria-label={`품목 ${i + 1} 수량`} />
            <input name={`item_price_${i + 1}`} defaultValue={it ? String(it.unit_price) : ""} inputMode="numeric" placeholder="0" className="field num" aria-label={`품목 ${i + 1} 단가`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-2">
        <div className="form-row">
          <label className="label" htmlFor={`${idPrefix}-amount`}>총액(원) — 품목이 없을 때</label>
          <input id={`${idPrefix}-amount`} name="amount" defaultValue={items.length ? "" : quote ? String(quote.amount) : ""} inputMode="numeric" placeholder="300000" className="field num" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={`${idPrefix}-from`}>시공 가능일</label>
          <input id={`${idPrefix}-from`} type="date" name="available_from" defaultValue={quote?.available_from ?? ""} className="field mono" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={`${idPrefix}-until`}>견적 유효일</label>
          <input id={`${idPrefix}-until`} type="date" name="valid_until" defaultValue={quote?.valid_until ?? ""} className="field mono" />
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={`${idPrefix}-message`}>고객에게 보낼 말</label>
        <textarea id={`${idPrefix}-message`} name="message" rows={3} maxLength={1000} defaultValue={quote?.message ?? ""} placeholder="포함 범위, 소요 시간, 보증, 가능한 날짜 등" className="field" />
      </div>
    </>
  );
}
