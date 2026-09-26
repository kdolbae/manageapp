"use client";

import { useState } from "react";
import { PLACEMENT } from "@/lib/market";

/** 노출 위치를 고르면 분류 화면일 때만 분류 선택이 나타난다. */
export function PlacementFields({ categories }: { categories: { code: string; label: string }[] }) {
  const [placement, setPlacement] = useState("home");
  return (
    <>
      <div className="form-row">
        <label className="label" htmlFor="promo-placement">위치</label>
        <select id="promo-placement" name="placement" className="field" value={placement} onChange={(e) => setPlacement(e.target.value)}>
          {Object.entries(PLACEMENT).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      {placement === "category" && (
        <div className="form-row">
          <label className="label" htmlFor="promo-category">분류<span className="req">*</span></label>
          <select id="promo-category" name="category_code" className="field" defaultValue="" required>
            <option value="">고르세요</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
