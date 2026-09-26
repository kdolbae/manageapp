import type { CodeValue } from "@/lib/codes";

type Values = {
  category_code?: string;
  code?: string | null;
  name?: string;
  spec?: string | null;
  full_name?: string | null;
  unit?: string;
  min_stock?: number | string;
  memo?: string | null;
  status?: string;
  buy_price?: number | string;
  sell_price?: number | string;
  price_note?: string | null;
};

/** 품목 등록·수정 폼의 공통 칸 (단가 포함 — inventory.price 권한 화면에서만 쓴다). */
export function ItemFields({ idPrefix, categories, v, withStatus = false }: { idPrefix: string; categories: CodeValue[]; v: Values; withStatus?: boolean }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="form-row">
          <label className="label" htmlFor={id("cat")}>분류<span className="req">*</span></label>
          <select id={id("cat")} name="category_code" required defaultValue={v.category_code ?? categories[0]?.code ?? ""} className="field">
            {categories.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
            {v.category_code && !categories.some((c) => c.code === v.category_code) && <option value={v.category_code}>{v.category_code} (현재 값)</option>}
          </select>
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("code")}>코드</label>
          <input id={id("code")} name="code" defaultValue={v.code ?? ""} maxLength={30} placeholder="선택" className="field mono" />
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("name")}>품목명<span className="req">*</span></label>
        <input id={id("name")} name="name" required defaultValue={v.name ?? ""} maxLength={80} placeholder="예: 글라스" className="field" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="form-row">
          <label className="label" htmlFor={id("spec")}>규격</label>
          <input id={id("spec")} name="spec" defaultValue={v.spec ?? ""} maxLength={60} placeholder="예: 500ml" className="field" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("unit")}>단위</label>
          <input id={id("unit")} name="unit" defaultValue={v.unit ?? "EA"} maxLength={10} className="field" />
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("full")}>정식 명칭 <span className="font-normal">(거래명세서)</span></label>
        <input id={id("full")} name="full_name" defaultValue={v.full_name ?? ""} maxLength={120} className="field" />
      </div>
      <div className={`grid gap-2 ${withStatus ? "grid-cols-2" : ""}`}>
        <div className="form-row">
          <label className="label" htmlFor={id("min")}>최소재고</label>
          <input id={id("min")} name="min_stock" defaultValue={String(v.min_stock ?? 0)} inputMode="decimal" className="field mono text-right" />
        </div>
        {withStatus && (
          <div className="form-row">
            <label className="label" htmlFor={id("status")}>상태</label>
            <select id={id("status")} name="status" defaultValue={v.status ?? "active"} className="field">
              <option value="active">사용</option>
              <option value="inactive">중지</option>
            </select>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="form-row">
          <label className="label" htmlFor={id("buy")}>매입단가 <span className="font-normal">(부가세 별도)</span></label>
          <input id={id("buy")} name="buy_price" defaultValue={String(Math.round(Number(v.buy_price ?? 0)))} inputMode="numeric" className="field mono text-right" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("sell")}>판매단가 <span className="font-normal">(0 = 미설정)</span></label>
          <input id={id("sell")} name="sell_price" defaultValue={String(Math.round(Number(v.sell_price ?? 0)))} inputMode="numeric" className="field mono text-right" />
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("pnote")}>단가 메모</label>
        <input id={id("pnote")} name="price_note" defaultValue={v.price_note ?? ""} maxLength={200} placeholder="예: 단가표 2026.05~08 기준" className="field" />
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("memo")}>메모</label>
        <input id={id("memo")} name="memo" defaultValue={v.memo ?? ""} maxLength={1000} className="field" />
      </div>
    </>
  );
}
