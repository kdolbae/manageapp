import type { createClient } from "@/lib/supabase/server";
import type { CodeValue } from "@/lib/codes";

export type Db = Awaited<ReturnType<typeof createClient>>;
export type Option = { id: string; name: string };

export type InvItem = {
  id: string;
  category_code: string;
  code: string | null;
  name: string;
  spec: string | null;
  full_name: string | null;
  unit: string;
  min_stock: number | string;
  memo: string | null;
  status: string;
  sort_order: number;
};

export type Warehouse = {
  id: string;
  kind: string;
  name: string;
  branch_id: string | null;
  technician_id: string | null;
  is_default: boolean;
  status: string;
  sort_order: number;
  branch: { name: string } | null;
  technician: { name: string } | null;
};

export type StockRow = { item_id: string; warehouse_id: string; qty: number | string; last_moved_on: string | null };
export type ItemPrice = { item_id: string; buy_price: number | string; sell_price: number | string; price_note: string | null };

/** 품목 (보관된 것 제외). includeInactive 가 아니면 사용 중인 것만. */
export async function loadItems(db: Db, tenantId: string, includeInactive = false): Promise<InvItem[]> {
  let q = db.from("inv_item").select("id, category_code, code, name, spec, full_name, unit, min_stock, memo, status, sort_order").eq("tenant_id", tenantId).is("deleted_at", null);
  if (!includeInactive) q = q.eq("status", "active");
  const { data } = await q.order("sort_order").order("name").order("spec");
  return (data ?? []) as InvItem[];
}

/** 창고 (기본 창고 먼저). */
export async function loadWarehouses(db: Db, tenantId: string, includeInactive = false): Promise<Warehouse[]> {
  let q = db
    .from("warehouse")
    .select("id, kind, name, branch_id, technician_id, is_default, status, sort_order, branch:branch(name), technician:technician(name)")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (!includeInactive) q = q.eq("status", "active");
  const { data } = await q.order("is_default", { ascending: false }).order("sort_order").order("name");
  return (data ?? []) as unknown as Warehouse[];
}

/** 창고별 재고 (뷰). RLS 때문에 본인 범위 사용자는 본인 차량 창고 분만 온다. */
export async function loadStock(db: Db, tenantId: string): Promise<StockRow[]> {
  const { data } = await db.from("inv_stock").select("item_id, warehouse_id, qty, last_moved_on").eq("tenant_id", tenantId);
  return (data ?? []) as StockRow[];
}

/** 단가 (inventory.price 권한이 없으면 RLS 가 빈 목록을 돌려준다). */
export async function loadPrices(db: Db, tenantId: string): Promise<Map<string, ItemPrice>> {
  const { data } = await db.from("inv_item_price").select("item_id, buy_price, sell_price, price_note").eq("tenant_id", tenantId);
  return new Map(((data ?? []) as ItemPrice[]).map((p) => [p.item_id, p]));
}

/** 로그인 사용자와 연결된 시공자(있으면). */
export async function myTechnician(db: Db, tenantId: string, userId: string): Promise<Option | null> {
  const { data } = await db.from("technician").select("id, name").eq("tenant_id", tenantId).eq("profile_id", userId).is("deleted_at", null).maybeSingle();
  return (data as Option | null) ?? null;
}

export async function technicianOptions(db: Db, tenantId: string): Promise<Option[]> {
  const { data } = await db.from("technician").select("id, name").eq("tenant_id", tenantId).eq("status", "active").is("deleted_at", null).order("name");
  return (data ?? []) as Option[];
}

export const stockKey = (itemId: string, warehouseId: string) => `${itemId}|${warehouseId}`;

/** 재고 행을 (품목|창고) → 수량, 품목 → 합계, 품목 → 최근 이동일 로 정리. */
export function indexStock(rows: StockRow[]) {
  const byCell = new Map<string, number>();
  const total = new Map<string, number>();
  const last = new Map<string, string>();
  for (const r of rows) {
    const q = Number(r.qty) || 0;
    byCell.set(stockKey(r.item_id, r.warehouse_id), (byCell.get(stockKey(r.item_id, r.warehouse_id)) ?? 0) + q);
    total.set(r.item_id, (total.get(r.item_id) ?? 0) + q);
    if (r.last_moved_on && (!last.has(r.item_id) || r.last_moved_on > last.get(r.item_id)!)) last.set(r.item_id, r.last_moved_on);
  }
  return { byCell, total, last };
}

/** 분류 순서대로 품목을 묶는다 (select 의 optgroup, 재고 표의 정렬). 분류가 없어진 품목은 맨 뒤 '기타'. */
export function groupByCategory(items: InvItem[], categories: CodeValue[]) {
  const groups = categories.map((c) => ({ code: c.code, label: c.label, items: items.filter((i) => i.category_code === c.code) }));
  const known = new Set(categories.map((c) => c.code));
  const rest = items.filter((i) => !known.has(i.category_code));
  if (rest.length) groups.push({ code: "", label: "미분류", items: rest });
  return groups.filter((g) => g.items.length > 0);
}

// ---------------------------------------------------------------- 입출고 내역 조회
/** inv_move → 창고 2개·profile 2개는 FK 이름을 힌트로 준다. */
export const MOVE_SELECT =
  "id, item_id, kind, qty, moved_on, reason, partner_name, doc_no, note, job_id, contract_id, technician_id, created_by, created_at, voided_at, void_reason, " +
  "item:inv_item(name, spec, unit, category_code), " +
  "from_wh:warehouse!inv_move_from_warehouse_id_fkey(name), to_wh:warehouse!inv_move_to_warehouse_id_fkey(name), " +
  "partner:partner(name), contract:contract(contract_no), technician:technician(name), " +
  "creator:profile!inv_move_created_by_fkey(display_name), voider:profile!inv_move_voided_by_fkey(display_name)";
export const MOVE_AMOUNT_SELECT = ", amount:inv_move_amount(unit_price, supply_amount, vat_amount)";

export type MoveAmount = { unit_price: number | string; supply_amount: number | string; vat_amount: number | string };
export type MoveRow = {
  id: string;
  item_id: string;
  kind: string;
  qty: number | string;
  moved_on: string;
  reason: string;
  partner_name: string | null;
  doc_no: string | null;
  note: string | null;
  job_id: string | null;
  contract_id: string | null;
  technician_id: string | null;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  item: { name: string; spec: string | null; unit: string; category_code: string } | null;
  from_wh: { name: string } | null;
  to_wh: { name: string } | null;
  partner: { name: string } | null;
  contract: { contract_no: string } | null;
  technician: { name: string } | null;
  creator: { display_name: string } | null;
  voider: { display_name: string } | null;
  amount?: MoveAmount | MoveAmount[] | null;
};

/** 금액 행: PostgREST 가 1:1 로 판단하면 객체, 아니면 배열로 오므로 둘 다 받는다. */
export function amountOf(m: MoveRow): MoveAmount | null {
  if (!m.amount) return null;
  return Array.isArray(m.amount) ? (m.amount[0] ?? null) : m.amount;
}
