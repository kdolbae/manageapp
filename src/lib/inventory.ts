/** 자재·창고 화면 공용 라벨과 순수 헬퍼 (서버 컴포넌트·서버 액션 양쪽에서 쓴다). */

export type BadgeFamily = "wait" | "run" | "done" | "risk";
export type MoveKind = "in" | "out" | "transfer" | "adjust";

export const MOVE_KIND: Record<MoveKind, { label: string; badge: BadgeFamily }> = {
  in: { label: "입고", badge: "done" },
  out: { label: "출고", badge: "run" },
  transfer: { label: "이동", badge: "wait" },
  adjust: { label: "조정", badge: "risk" },
};
export const MOVE_KINDS = Object.keys(MOVE_KIND) as MoveKind[];

/** 사유와 그 사유가 붙는 구분. 조정은 방향에 따라 adjust_in / adjust_out. */
export const MOVE_REASON: Record<string, { label: string; kind: MoveKind }> = {
  purchase: { label: "매입", kind: "in" },
  return_in: { label: "반품 입고", kind: "in" },
  adjust_in: { label: "재고 보정(+)", kind: "adjust" },
  opening: { label: "기초재고", kind: "in" },
  install: { label: "시공 사용", kind: "out" },
  sale: { label: "판매", kind: "out" },
  sample: { label: "샘플", kind: "out" },
  waste: { label: "폐기", kind: "out" },
  return_out: { label: "반품 출고", kind: "out" },
  adjust_out: { label: "재고 보정(−)", kind: "adjust" },
  transfer: { label: "창고 이동", kind: "transfer" },
};

/** 화면의 사유 선택지: 입고는 매입·반품 입고·재고 보정(+), 출고는 시공 사용·판매·샘플·폐기·반품 출고. */
export const IN_REASONS = ["purchase", "return_in", "adjust_in"] as const;
export const OUT_REASONS = ["install", "sale", "sample", "waste", "return_out"] as const;

export function reasonLabel(reason: string | null | undefined) {
  return reason ? (MOVE_REASON[reason]?.label ?? reason) : "";
}

export const WAREHOUSE_KIND: Record<string, string> = { hq: "본사", branch: "지점", vehicle: "차량", site: "현장" };

/** 수량(numeric(12,2)) 표시: 3 → "3", 1.5 → "1.5", 1234.25 → "1,234.25". */
export function qtyText(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

/** 품목 표시 이름: 이름 + 규격. */
export function itemLabel(item: { name: string; spec?: string | null }) {
  return item.spec ? `${item.name} ${item.spec}` : item.name;
}

// ---------------------------------------------------------------- CSV
/** CSV 헤더(그대로 써야 한다). 순서는 바뀌어도 되고, 분류·품목명만 필수다. */
export const ITEM_CSV_HEADER = "분류,품목명,규격,정식명칭,단위,매입단가,판매단가,기초재고,최소재고,단가메모,사용";

export type ItemCsvRow = {
  line: number;
  category: string;
  name: string;
  spec: string | null;
  full_name: string | null;
  unit: string;
  buy_price: number | null;
  sell_price: number | null;
  opening: number;
  min_stock: number;
  price_note: string | null;
  active: boolean;
};

/** 따옴표·쉼표·줄바꿈이 든 값과 BOM·CRLF 를 처리하는 작은 CSV 파서. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function numberCell(v: string | undefined): number | null | typeof NaN {
  const s = (v ?? "").replace(/[,\s원]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 품목 CSV 를 행 객체로. 첫 줄은 헤더여야 한다.
 * 돌려주는 skipped 에는 건너뛴 줄과 이유가 들어 있다.
 */
export function parseItemCsv(text: string): { rows: ItemCsvRow[]; skipped: { line: number; reason: string }[]; columns: Set<string>; error?: string } {
  const table = parseCsv(text);
  const columns = new Set<string>();
  if (table.length === 0) return { rows: [], skipped: [], columns, error: "내용이 비어 있습니다." };
  const header = table[0].map((h) => h.trim());
  for (const h of header) if (h) columns.add(h);
  const col = (name: string) => header.indexOf(name);
  if (col("분류") < 0 || col("품목명") < 0) {
    return { rows: [], skipped: [], columns, error: `첫 줄은 헤더여야 합니다: ${ITEM_CSV_HEADER}` };
  }
  const idx = {
    category: col("분류"),
    name: col("품목명"),
    spec: col("규격"),
    full_name: col("정식명칭"),
    unit: col("단위"),
    buy: col("매입단가"),
    sell: col("판매단가"),
    opening: col("기초재고"),
    min: col("최소재고"),
    note: col("단가메모"),
    active: col("사용"),
  };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows: ItemCsvRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const category = cell(r, idx.category);
    const name = cell(r, idx.name);
    if (!category || !name) {
      skipped.push({ line, reason: "분류나 품목명이 비어 있습니다" });
      return;
    }
    const buy = numberCell(cell(r, idx.buy));
    const sell = numberCell(cell(r, idx.sell));
    const opening = numberCell(cell(r, idx.opening)) ?? 0;
    const min = numberCell(cell(r, idx.min)) ?? 0;
    if ([buy, sell, opening, min].some((n) => Number.isNaN(n)) || (buy ?? 0) < 0 || (sell ?? 0) < 0 || opening < 0 || min < 0) {
      skipped.push({ line, reason: "단가·재고 칸에 숫자가 아닌 값이 있습니다" });
      return;
    }
    const activeCell = cell(r, idx.active).toUpperCase();
    rows.push({
      line,
      category,
      name: name.slice(0, 80),
      spec: cell(r, idx.spec).slice(0, 60) || null,
      full_name: cell(r, idx.full_name).slice(0, 120) || null,
      unit: (cell(r, idx.unit) || "EA").slice(0, 10),
      buy_price: buy === null ? null : Math.round(buy),
      sell_price: sell === null ? null : Math.round(sell),
      opening: Math.round(opening * 100) / 100,
      min_stock: Math.round(min * 100) / 100,
      price_note: cell(r, idx.note).slice(0, 200) || null,
      active: !(activeCell === "N" || activeCell === "NO" || activeCell === "아니오" || activeCell === "미사용" || activeCell === "0"),
    });
  });
  return { rows, skipped, columns };
}
