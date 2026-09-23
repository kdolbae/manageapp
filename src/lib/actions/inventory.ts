"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import { todayKST } from "@/lib/dates";
import { MOVE_REASON, parseItemCsv, type MoveKind } from "@/lib/inventory";
import type { ActionState } from "@/lib/actions/auth";

// ---------------------------------------------------------------- 공통
type Db = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string; message: string };

const MAX_AMOUNT = 99_999_999_999_999; // numeric(14,0)
const MAX_QTY = 99_999_999; // numeric(12,2)

const uuid = z.string().uuid();
const optUuid = z
  .string()
  .uuid()
  .or(z.literal(""))
  .optional()
  .transform((v) => (v ? v : null));
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
/** "1,234" · "1 234원" → "1234". 빈 값은 undefined 로 넘겨 기본값이 쓰이게 한다. */
function cleanNumber(v: unknown) {
  if (typeof v !== "string") return v;
  const s = v.replace(/[,\s원]/g, "");
  return s === "" ? undefined : s;
}
const round2 = (v: number) => Math.round(v * 100) / 100;
/** 금액(원, 0 이상 정수). 비우면 0. */
const amount = z.preprocess(cleanNumber, z.coerce.number().int().min(0).max(MAX_AMOUNT).default(0));
/** 금액(선택). 비우면 null. */
const amountOpt = z.preprocess(cleanNumber, z.coerce.number().int().min(0).max(MAX_AMOUNT).nullable().default(null));
/** 수량(0 초과, 소수 둘째 자리까지). */
const qty = z.preprocess(cleanNumber, z.coerce.number().positive("수량은 0 보다 커야 합니다.").max(MAX_QTY)).transform(round2);
/** 0 이상 수량(최소재고). 비우면 0. */
const qtyZero = z.preprocess(cleanNumber, z.coerce.number().min(0).max(MAX_QTY).default(0)).transform(round2);
/** <input type="date"> 값. 비우면 null. */
const dateOpt = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .pipe(z.iso.date().nullable());
/** 체크박스: 체크되면 "on". */
const flag = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());
const status = z.enum(["active", "inactive"]);

const fail = (message: string): ActionState => ({ error: message });

/** 우리가 적은 한국어 메시지면 그대로, zod 기본(영문) 메시지면 대체 문구로. */
function issueMessage(error: z.ZodError, fallback: string) {
  const m = error.issues[0]?.message;
  return m && /[가-힣]/.test(m) ? m : fallback;
}

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

/**
 * Supabase 오류를 한국어로.
 *  - 트리거가 올린 '재고 부족: …' 은 그대로 보여 준다 (P0001)
 *  - 42501 은 RLS 거부(영문)면 권한 문구로, 트리거의 한국어 메시지('입출고 내역은 고칠 수 없습니다' 등)면 그대로
 */
function dbMessage(error: DbError): string {
  const m = error.message ?? "";
  if (m.startsWith("재고 부족")) return m;
  switch (error.code) {
    case "42501":
      return /[가-힣]/.test(m) ? m : "권한이 없거나 내 범위(지점·담당) 밖입니다.";
    case "23505":
      return "같은 값이 이미 있습니다.";
    case "23503":
      return "연결하려는 항목(품목·창고·시공 건·협력업체)을 찾지 못했습니다.";
    case "23514":
      return "입력값이 규칙에 맞지 않습니다. 구분과 창고 조합을 확인해 주세요.";
    default:
      return m || "처리하지 못했습니다.";
  }
}

const INVENTORY_PATHS = ["/inventory", "/inventory/out", "/inventory/in", "/inventory/moves", "/inventory/items", "/inventory/warehouses"];
function revalidateInventory() {
  for (const p of INVENTORY_PATHS) revalidatePath(p);
}

async function categoryExists(supabase: Db, tenantId: string, code: string) {
  const { data } = await supabase.from("code_value").select("id").eq("tenant_id", tenantId).eq("domain", "inv_category").eq("code", code).maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------- 품목
const itemInput = z.object({
  category_code: z.string().trim().min(1, "분류를 골라 주세요.").max(40),
  code: optText(30),
  name: z.string().trim().min(1, "품목명을 입력해 주세요.").max(80, "품목명은 80자까지입니다."),
  spec: optText(60),
  full_name: optText(120),
  unit: z
    .string()
    .trim()
    .max(10)
    .optional()
    .transform((v) => v || "EA"),
  min_stock: qtyZero,
  memo: optText(1000),
  buy_price: amount,
  sell_price: amount,
  price_note: optText(200),
});
const ITEM_DUP = "같은 분류·품목명·규격(또는 같은 코드)의 품목이 이미 있습니다.";

function splitItem(data: z.infer<typeof itemInput>) {
  const { buy_price, sell_price, price_note, ...item } = data;
  return { item, price: { buy_price, sell_price, price_note } };
}

export async function createItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = itemInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요."));
  const { supabase, tenantId } = await ctx("inventory.price");
  if (!(await categoryExists(supabase, tenantId, parsed.data.category_code))) return fail("분류를 확인해 주세요.");
  const { item, price } = splitItem(parsed.data);
  const { data, error } = await supabase.from("inv_item").insert({ tenant_id: tenantId, ...item }).select("id").single();
  if (error) return fail(error.code === "23505" ? ITEM_DUP : dbMessage(error));
  const { error: pe } = await supabase.from("inv_item_price").upsert({ item_id: data.id, tenant_id: tenantId, ...price }, { onConflict: "item_id" });
  revalidateInventory();
  if (pe) return fail(`품목은 추가했지만 단가를 저장하지 못했습니다: ${dbMessage(pe)}`);
  return { ok: `품목 '${item.name}' 을 추가했습니다.` };
}

export async function updateItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = itemInput.extend({ id: uuid, status }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요."));
  const { supabase, tenantId } = await ctx("inventory.price");
  const { id, status: st, ...rest } = parsed.data;
  if (!(await categoryExists(supabase, tenantId, rest.category_code))) return fail("분류를 확인해 주세요.");
  const { item, price } = splitItem(rest);
  const { error, count } = await supabase
    .from("inv_item")
    .update({ ...item, status: st }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(error.code === "23505" ? ITEM_DUP : dbMessage(error));
  if (!count) return fail("품목을 찾지 못했습니다.");
  const { error: pe } = await supabase.from("inv_item_price").upsert({ item_id: id, tenant_id: tenantId, ...price }, { onConflict: "item_id" });
  revalidateInventory();
  if (pe) return fail(`품목은 저장했지만 단가를 저장하지 못했습니다: ${dbMessage(pe)}`);
  return { ok: "저장했습니다." };
}

/** 보관(soft delete). 재고가 남아 있으면 막는다 — 재고 현황에서 사라져 수량이 숨어 버리기 때문. */
export async function archiveItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("inventory.price");
  const { data: stock } = await supabase.from("inv_stock").select("qty").eq("tenant_id", tenantId).eq("item_id", id.data);
  const remaining = ((stock ?? []) as { qty: number | string }[]).reduce((s, r) => s + Number(r.qty), 0);
  if (remaining !== 0) return fail(`재고가 ${remaining} 남아 있는 품목은 보관할 수 없습니다. 조정으로 0 으로 맞추거나 상태를 '중지'로 바꿔 주세요.`);
  const { error, count } = await supabase
    .from("inv_item")
    .update({ deleted_at: new Date().toISOString(), status: "inactive" }, { count: "exact" })
    .eq("id", id.data)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(dbMessage(error));
  if (!count) return fail("품목을 찾지 못했습니다.");
  revalidateInventory();
  return { ok: "보관했습니다. 목록에서 사라지지만 입출고 내역은 남습니다." };
}

// ---------------------------------------------------------------- CSV 가져오기
/** 새 분류 코드: 'c' + 라벨의 영숫자 슬러그(있으면) + 짧은 해시. 같은 라벨이면 항상 같은 코드. */
function categoryCode(label: string) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12);
  const hash = createHash("sha1").update(label.normalize("NFC")).digest("hex").slice(0, slug ? 4 : 6);
  return `c${slug}${slug ? "_" : ""}${hash}`;
}
const normLabel = (s: string) => s.normalize("NFC").replace(/\s+/g, "").toLowerCase();

export async function importItemsCsv(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formData.get("csv");
  if (typeof raw !== "string" || !raw.trim()) return fail("CSV 내용을 붙여 넣어 주세요.");
  if (raw.length > 500_000) return fail("한 번에 500KB 까지 가져올 수 있습니다.");
  const parsed = parseItemCsv(raw);
  if (parsed.error) return fail(parsed.error);
  const { session, supabase, tenantId } = await ctx("inventory.price");
  const skipped = [...parsed.skipped];

  // 1) 분류: 라벨(또는 코드)로 맞추고, 없으면 만든다 (code_value 쓰기는 사업체 설정 권한이 필요할 수 있다)
  const { data: catRows } = await supabase.from("code_value").select("code, label, sort_order").eq("tenant_id", tenantId).eq("domain", "inv_category");
  const cats = (catRows ?? []) as { code: string; label: string; sort_order: number }[];
  const byLabel = new Map<string, string>();
  for (const c of cats) {
    byLabel.set(normLabel(c.label), c.code);
    byLabel.set(normLabel(c.code), c.code);
  }
  const missing = Array.from(new Set(parsed.rows.map((r) => r.category).filter((l) => !byLabel.has(normLabel(l)))));
  let nextSort = cats.filter((c) => c.code !== "etc").reduce((m, c) => Math.max(m, c.sort_order), 0) + 1;
  const createdCategories: string[] = [];
  let categoryError: string | null = null;
  for (const label of missing) {
    const code = categoryCode(label);
    const { error } = await supabase
      .from("code_value")
      .insert({ tenant_id: tenantId, domain: "inv_category", code, label: label.slice(0, 40), sort_order: nextSort++, meta: { source: "csv_import" } });
    if (error) {
      categoryError = error.code === "42501" ? "분류(코드값)를 만들 권한이 없습니다. 사업체 설정 권한자가 분류를 먼저 만들어 주세요" : dbMessage(error);
      break;
    }
    byLabel.set(normLabel(label), code);
    createdCategories.push(label);
  }

  // 2) 기존 품목과 (분류, 품목명, 규격) 으로 맞춘다
  const { data: existingRows } = await supabase.from("inv_item").select("id, category_code, name, spec").eq("tenant_id", tenantId).is("deleted_at", null);
  const key = (c: string, n: string, s: string | null) => `${c}\u0001${n}\u0001${s ?? ""}`;
  const existing = new Map<string, string>();
  for (const e of (existingRows ?? []) as { id: string; category_code: string; name: string; spec: string | null }[]) existing.set(key(e.category_code, e.name, e.spec), e.id);
  const seen = new Set<string>();
  type Row = (typeof parsed.rows)[number];
  const toInsert: { row: Row; code: string }[] = [];
  const toUpdate: { row: Row; code: string; id: string }[] = [];
  for (const row of parsed.rows) {
    const code = byLabel.get(normLabel(row.category));
    if (!code) {
      skipped.push({ line: row.line, reason: `분류 '${row.category}' 없음` });
      continue;
    }
    const k = key(code, row.name, row.spec);
    if (seen.has(k)) {
      skipped.push({ line: row.line, reason: "같은 분류·품목명·규격이 위에 또 있습니다" });
      continue;
    }
    seen.add(k);
    const id = existing.get(k);
    if (id) toUpdate.push({ row, code, id });
    else toInsert.push({ row, code });
  }

  // 3) 새 품목은 한 번에, 갱신은 줄마다
  const itemIds = new Map<number, string>(); // csv line → item id
  if (toInsert.length) {
    const { data, error } = await supabase
      .from("inv_item")
      .insert(
        toInsert.map(({ row, code }) => ({
          tenant_id: tenantId,
          category_code: code,
          name: row.name,
          spec: row.spec,
          full_name: row.full_name,
          unit: row.unit,
          min_stock: row.min_stock,
          status: row.active ? "active" : "inactive",
        })),
      )
      .select("id, category_code, name, spec");
    if (error) return fail(`품목을 추가하지 못했습니다: ${dbMessage(error)}`);
    const created = new Map<string, string>();
    for (const e of (data ?? []) as { id: string; category_code: string; name: string; spec: string | null }[]) created.set(key(e.category_code, e.name, e.spec), e.id);
    for (const { row, code } of toInsert) {
      const id = created.get(key(code, row.name, row.spec));
      if (id) itemIds.set(row.line, id);
    }
  }
  // 기존 품목은 CSV 에 있는 열만 덮어쓴다 (열이 없으면 그 값은 그대로)
  const has = (c: string) => parsed.columns.has(c);
  let updated = 0;
  for (const { row, id } of toUpdate) {
    const patch: Record<string, unknown> = {};
    if (has("정식명칭")) patch.full_name = row.full_name;
    if (has("단위")) patch.unit = row.unit;
    if (has("최소재고")) patch.min_stock = row.min_stock;
    if (has("사용")) patch.status = row.active ? "active" : "inactive";
    const { error } = Object.keys(patch).length ? await supabase.from("inv_item").update(patch).eq("id", id).eq("tenant_id", tenantId) : { error: null };
    if (error) skipped.push({ line: row.line, reason: `갱신 실패: ${dbMessage(error)}` });
    else {
      updated += 1;
      itemIds.set(row.line, id);
    }
  }

  // 4) 단가: 새 품목은 항상, 기존 품목은 단가 칸이 채워져 있을 때만
  const priceRows = [
    ...toInsert.filter(({ row }) => itemIds.has(row.line)),
    ...toUpdate.filter(({ row }) => itemIds.has(row.line) && (row.buy_price !== null || row.sell_price !== null || row.price_note !== null)),
  ].map(({ row }) => ({ item_id: itemIds.get(row.line)!, tenant_id: tenantId, buy_price: row.buy_price ?? 0, sell_price: row.sell_price ?? 0, price_note: row.price_note }));
  let priceError: string | null = null;
  if (priceRows.length) {
    const { error } = await supabase.from("inv_item_price").upsert(priceRows, { onConflict: "item_id" });
    if (error) priceError = dbMessage(error);
  }

  // 5) 기초재고: 기본 창고로 입고(opening). 그 품목에 기초재고 입고가 이미 있으면 건너뛴다
  let opened = 0;
  let openingNote: string | null = null;
  const openingRows = [...toInsert, ...toUpdate].filter(({ row }) => row.opening > 0 && itemIds.has(row.line));
  if (openingRows.length) {
    if (!session.can("inventory.move")) openingNote = "기초재고는 입출고 권한이 없어 등록하지 않았습니다";
    else {
      const { data: wh } = await supabase.from("warehouse").select("id").eq("tenant_id", tenantId).eq("is_default", true).is("deleted_at", null).maybeSingle();
      if (!wh) openingNote = "기본 창고가 없어 기초재고를 등록하지 않았습니다";
      else {
        const ids = openingRows.map(({ row }) => itemIds.get(row.line)!);
        const { data: prior } = await supabase.from("inv_move").select("item_id").eq("tenant_id", tenantId).eq("reason", "opening").is("voided_at", null).in("item_id", ids);
        const has = new Set(((prior ?? []) as { item_id: string }[]).map((p) => p.item_id));
        const moves = openingRows
          .filter(({ row }) => !has.has(itemIds.get(row.line)!))
          .map(({ row }) => ({ tenant_id: tenantId, item_id: itemIds.get(row.line)!, kind: "in", qty: row.opening, to_warehouse_id: wh.id, moved_on: todayKST(), reason: "opening", note: "기초재고 (CSV 가져오기)" }));
        if (moves.length) {
          const { error } = await supabase.from("inv_move").insert(moves);
          if (error) openingNote = `기초재고 등록 실패: ${dbMessage(error)}`;
          else opened = moves.length;
        }
      }
    }
  }

  revalidateInventory();
  const parts = [`새 품목 ${itemIds.size - updated}`, `갱신 ${updated}`, `기초재고 등록 ${opened}`, `건너뜀 ${skipped.length}건`];
  const notes: string[] = [];
  if (createdCategories.length) notes.push(`새 분류를 만들었습니다: ${createdCategories.join(", ")}`);
  if (categoryError) notes.push(categoryError);
  if (priceError) notes.push(`단가 저장 실패: ${priceError}`);
  if (openingNote) notes.push(openingNote);
  if (skipped.length) notes.push(`건너뜀: ${skipped.slice(0, 6).map((s) => `${s.line}줄 ${s.reason}`).join("; ")}${skipped.length > 6 ? " 외" : ""}`);
  const summary = parts.join(" · ") + (notes.length ? ` — ${notes.join(" / ")}` : "");
  return itemIds.size === 0 && skipped.length > 0 ? fail(summary) : { ok: summary };
}

// ---------------------------------------------------------------- 창고
const warehouseInput = z.object({
  kind: z.enum(["hq", "branch", "vehicle", "site"]),
  name: z.string().trim().min(1, "창고 이름을 입력해 주세요.").max(40, "창고 이름은 40자까지입니다."),
  branch_id: optUuid,
  technician_id: optUuid,
  is_default: flag,
});

function warehouseDup(error: DbError) {
  if (error.code !== "23505") return dbMessage(error);
  return error.message.includes("warehouse_technician_uq") ? "그 시공자에게는 이미 차량 창고가 있습니다." : "같은 이름의 창고가 이미 있습니다.";
}

async function applyDefault(supabase: Db, tenantId: string, id: string) {
  const { error } = await supabase.from("warehouse").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true).neq("id", id);
  if (error) return error;
  const { error: e2 } = await supabase.from("warehouse").update({ is_default: true }).eq("id", id).eq("tenant_id", tenantId);
  return e2;
}

export async function createWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = warehouseInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요."));
  const { supabase, tenantId } = await ctx("inventory.price");
  const { is_default, ...rest } = parsed.data;
  if (rest.kind === "vehicle" && !rest.technician_id) return fail("차량 창고는 시공자를 골라 주세요.");
  if (rest.kind !== "vehicle") rest.technician_id = null;
  const { data, error } = await supabase.from("warehouse").insert({ tenant_id: tenantId, ...rest }).select("id").single();
  if (error) return fail(warehouseDup(error));
  if (is_default) {
    const e = await applyDefault(supabase, tenantId, data.id);
    if (e) return fail(`창고는 추가했지만 기본 창고로 지정하지 못했습니다: ${dbMessage(e)}`);
  }
  revalidateInventory();
  return { ok: `창고 '${rest.name}' 을 추가했습니다.` };
}

export async function updateWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = warehouseInput.extend({ id: uuid, status }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error, "입력값을 확인해 주세요."));
  const { supabase, tenantId } = await ctx("inventory.price");
  const { id, is_default, ...rest } = parsed.data;
  if (rest.kind === "vehicle" && !rest.technician_id) return fail("차량 창고는 시공자를 골라 주세요.");
  if (rest.kind !== "vehicle") rest.technician_id = null;
  const { data: current } = await supabase.from("warehouse").select("is_default").eq("id", id).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle();
  if (!current) return fail("창고를 찾지 못했습니다.");
  if (rest.status === "inactive" && (current.is_default || is_default)) return fail("기본 창고는 중지할 수 없습니다. 먼저 다른 창고를 기본으로 지정해 주세요.");
  const { error, count } = await supabase.from("warehouse").update(rest, { count: "exact" }).eq("id", id).eq("tenant_id", tenantId).is("deleted_at", null);
  if (error) return fail(warehouseDup(error));
  if (!count) return fail("창고를 찾지 못했습니다.");
  if (is_default && !current.is_default) {
    const e = await applyDefault(supabase, tenantId, id);
    if (e) return fail(`저장했지만 기본 창고로 지정하지 못했습니다: ${dbMessage(e)}`);
  }
  revalidateInventory();
  return { ok: "저장했습니다." };
}

/** 창고 목록의 '기본' 라디오 저장. */
export async function setDefaultWarehouse(formData: FormData) {
  const id = uuid.safeParse(formData.get("default_id"));
  if (!id.success) return;
  const { supabase, tenantId } = await ctx("inventory.price");
  const { data: wh } = await supabase.from("warehouse").select("id").eq("id", id.data).eq("tenant_id", tenantId).eq("status", "active").is("deleted_at", null).maybeSingle();
  if (!wh) return;
  await applyDefault(supabase, tenantId, id.data);
  revalidateInventory();
}

// ---------------------------------------------------------------- 입출고
const moveInput = z.object({
  kind: z.enum(["in", "out", "transfer", "adjust"]),
  item_id: z.string().uuid("품목을 골라 주세요."),
  qty,
  from_warehouse_id: optUuid,
  to_warehouse_id: optUuid,
  /** 조정용: 창고 하나 + 방향 */
  warehouse_id: optUuid,
  direction: z.enum(["plus", "minus"]).optional(),
  moved_on: dateOpt,
  reason: optText(20),
  partner_id: optUuid,
  partner_name: optText(80),
  doc_no: optText(40),
  job_id: optUuid,
  note: optText(500),
  technician_id: optUuid,
  unit_price: amountOpt,
});

/** 구분별로 창고·사유를 정리한다. 규칙은 DB check 와 같다. */
function normalizeMove(d: z.infer<typeof moveInput>): { error: string } | { from: string | null; to: string | null; reason: string } {
  const kind: MoveKind = d.kind;
  if (kind === "in") {
    if (!d.to_warehouse_id) return { error: "입고할 창고를 골라 주세요." };
    const reason = d.reason && MOVE_REASON[d.reason]?.kind === "in" ? d.reason : "purchase";
    return { from: null, to: d.to_warehouse_id, reason };
  }
  if (kind === "out") {
    if (!d.from_warehouse_id) return { error: "출고할 창고를 골라 주세요." };
    const reason = d.reason && MOVE_REASON[d.reason]?.kind === "out" ? d.reason : "install";
    return { from: d.from_warehouse_id, to: null, reason };
  }
  if (kind === "transfer") {
    if (!d.from_warehouse_id || !d.to_warehouse_id) return { error: "보내는 창고와 받는 창고를 골라 주세요." };
    if (d.from_warehouse_id === d.to_warehouse_id) return { error: "보내는 창고와 받는 창고가 같습니다." };
    return { from: d.from_warehouse_id, to: d.to_warehouse_id, reason: "transfer" };
  }
  const wh = d.warehouse_id ?? d.to_warehouse_id ?? d.from_warehouse_id;
  if (!wh) return { error: "조정할 창고를 골라 주세요." };
  const direction = d.direction ?? (d.reason === "adjust_out" ? "minus" : d.reason === "adjust_in" ? "plus" : null);
  if (!direction) return { error: "조정 방향(+/−)을 골라 주세요." };
  if (!d.note) return { error: "조정은 사유(메모)를 꼭 적어 주세요." };
  return direction === "plus" ? { from: null, to: wh, reason: "adjust_in" } : { from: wh, to: null, reason: "adjust_out" };
}

const KIND_DONE: Record<MoveKind, string> = { in: "입고를 등록했습니다.", out: "출고를 등록했습니다.", transfer: "창고 이동을 등록했습니다.", adjust: "재고 조정을 등록했습니다." };

export async function createMove(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = moveInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error, "품목·수량·창고를 확인해 주세요. 수량은 0 보다 큰 숫자(소수 둘째 자리까지)입니다."));
  const { session, supabase, tenantId } = await ctx("inventory.move");
  const d = parsed.data;
  const n = normalizeMove(d);
  if ("error" in n) return fail(n.error);
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    item_id: d.item_id,
    kind: d.kind,
    qty: d.qty,
    from_warehouse_id: n.from,
    to_warehouse_id: n.to,
    moved_on: d.moved_on ?? todayKST(),
    reason: n.reason,
    partner_id: d.partner_id,
    partner_name: d.partner_id ? null : d.partner_name,
    doc_no: d.doc_no,
    job_id: d.job_id,
    note: d.note,
  };
  // 시공자는 관리자만 고른다. 본인 범위 사용자는 DB 트리거가 본인 시공자로 채운다.
  if (session.current.scope !== "own" && d.technician_id) row.technician_id = d.technician_id;
  const { data, error } = await supabase.from("inv_move").insert(row).select("id").single();
  if (error) {
    let msg = dbMessage(error);
    if (msg.startsWith("재고 부족")) msg += " — 재고보다 많이 내는 출고는 '재고 초과 출고 승인' 권한이 있는 관리자만 할 수 있습니다.";
    return fail(msg);
  }
  let priceNote = "";
  if (d.unit_price !== null && session.can("inventory.price")) {
    const { error: pe } = await supabase.from("inv_move_amount").update({ unit_price: d.unit_price }).eq("move_id", data.id).eq("tenant_id", tenantId);
    if (pe) priceNote = ` 단가는 저장하지 못했습니다: ${dbMessage(pe)}`;
  }
  revalidateInventory();
  return { ok: KIND_DONE[d.kind] + priceNote };
}

export async function voidMove(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, void_reason: z.string().trim().min(1, "취소 사유를 적어 주세요.").max(200) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(issueMessage(parsed.error, "취소 사유를 적어 주세요."));
  const { supabase, tenantId } = await ctx("inventory.move");
  const { error, count } = await supabase
    .from("inv_move")
    .update({ voided_at: new Date().toISOString(), void_reason: parsed.data.void_reason }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .is("voided_at", null);
  if (error) return fail(dbMessage(error));
  if (!count) return fail("내역을 찾지 못했거나 이미 취소되었거나 권한이 없습니다.");
  revalidateInventory();
  return { ok: "취소했습니다. 재고는 다시 계산됩니다." };
}

export async function updateMoveAmount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ move_id: uuid, unit_price: z.preprocess(cleanNumber, z.coerce.number().int().min(0).max(MAX_AMOUNT)) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("단가는 0 이상 정수(원)여야 합니다.");
  const { supabase, tenantId } = await ctx("inventory.price");
  const { error, count } = await supabase
    .from("inv_move_amount")
    .update({ unit_price: parsed.data.unit_price }, { count: "exact" })
    .eq("move_id", parsed.data.move_id)
    .eq("tenant_id", tenantId);
  if (error) return fail(dbMessage(error));
  if (!count) return fail("금액 행을 찾지 못했습니다.");
  revalidateInventory();
  return { ok: "단가를 고쳤습니다. 공급가·부가세는 다시 계산됩니다." };
}
