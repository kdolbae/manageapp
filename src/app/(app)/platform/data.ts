import type { createClient } from "@/lib/supabase/server";
import type { QuoteItem } from "@/lib/market";

/* 플랫폼 운영 화면들이 같이 쓰는 조회·타입. 서버 컴포넌트에서만 부른다. 모든 행은 RLS 가 운영자에게만 돌려준다. */

export type Db = Awaited<ReturnType<typeof createClient>>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LINE_KIND: Record<string, string> = { fee: "수수료", ad: "광고", adjust: "조정" };
export const SENDER: Record<string, string> = { customer: "고객", vendor: "업체", platform: "집대리" };

/** 지금 시각(ISO). 만료 비교용 — 렌더 안에서 Date 를 직접 만들지 않으려고 뺐다. */
export const nowIso = () => new Date().toISOString();

/** ?s=pending 같은 목록 필터값. 허용 목록에 없으면 기본값 */
export function filterParam<T extends string>(v: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

// ---------------------------------------------------------------- 업체 (뷰 platform_vendor: 노출 전 업체 포함, 운영자만)
export type PlatformVendor = {
  tenant_id: string;
  slug: string;
  name: string;
  tenant_status: string;
  business_no: string | null;
  brand: Record<string, unknown>;
  tenant_created_at: string;
  categories: string[];
  regions: string[];
  intro: string | null;
  highlights: string[];
  is_listed: boolean;
  listed_at: string | null;
  updated_at: string;
  fee_type: string | null;
  rate: number | null;
  fixed_amount: number | null;
  min_fee: number | null;
  max_fee: number | null;
  cycle: string | null;
  fee_memo: string | null;
  quote_count: number;
  accepted_count: number;
  member_count: number;
  pending_invite_email: string | null;
  pending_invite_token: string | null;
};

export const PLATFORM_VENDOR_SELECT =
  "tenant_id, slug, name, tenant_status, business_no, brand, tenant_created_at, categories, regions, intro, highlights, is_listed, listed_at, updated_at, " +
  "fee_type, rate, fixed_amount, min_fee, max_fee, cycle, fee_memo, quote_count, accepted_count, member_count, pending_invite_email, pending_invite_token";

export async function platformVendors(db: Db): Promise<PlatformVendor[]> {
  const { data } = await db.from("platform_vendor").select(PLATFORM_VENDOR_SELECT).order("name");
  return (data ?? []) as unknown as PlatformVendor[];
}

export async function vendorsByIds(db: Db, ids: string[]): Promise<PlatformVendor[]> {
  if (ids.length === 0) return [];
  const { data } = await db.from("platform_vendor").select(PLATFORM_VENDOR_SELECT).in("tenant_id", ids);
  return (data ?? []) as unknown as PlatformVendor[];
}

export function vendorNameMap(vendors: Pick<PlatformVendor, "tenant_id" | "name">[]): Map<string, string> {
  return new Map(vendors.map((v) => [v.tenant_id, v.name]));
}

/** 업체 소개가 없는 사업체(뷰에 안 나옴)는 id 앞자리로 */
export function vendorName(names: Map<string, string>, tenantId: string | null | undefined): string {
  if (!tenantId) return "—";
  return names.get(tenantId) ?? `업체 ${tenantId.slice(0, 8)}`;
}

// ---------------------------------------------------------------- 신청
export type Application = {
  id: string;
  name: string;
  business_no: string | null;
  ceo_name: string | null;
  phone: string;
  email: string;
  address: string | null;
  regions: string[];
  categories: string[];
  intro: string | null;
  website: string | null;
  slug_wanted: string | null;
  status: string;
  review_note: string | null;
  reviewed_at: string | null;
  tenant_id: string | null;
  created_at: string;
};
export const APPLICATION_SELECT =
  "id, name, business_no, ceo_name, phone, email, address, regions, categories, intro, website, slug_wanted, status, review_note, reviewed_at, tenant_id, created_at";

// ---------------------------------------------------------------- 요청 · 견적 · 대화 (원본 행: 이름·전화 포함)
export type ServiceRequest = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  region: string;
  apt: string | null;
  address: string | null;
  area_pyeong: number | null;
  move_in_date: string | null;
  categories: string[];
  message: string | null;
  budget: number | null;
  directed_tenant_id: string | null;
  external_id: string | null;
  status: string;
  accepted_quote_id: string | null;
  phone_shared: boolean;
  utm: Record<string, unknown>;
  expires_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};
export const REQUEST_SELECT =
  "id, name, phone, email, region, apt, address, area_pyeong, move_in_date, categories, message, budget, directed_tenant_id, external_id, status, accepted_quote_id, phone_shared, utm, expires_at, closed_at, created_at, updated_at";

export type Quote = {
  id: string;
  request_id: string;
  tenant_id: string;
  amount: number;
  items: QuoteItem[];
  message: string | null;
  available_from: string | null;
  valid_until: string | null;
  status: string;
  contract_id: string | null;
  created_at: string;
};
export const QUOTE_SELECT = "id, request_id, tenant_id, amount, items, message, available_from, valid_until, status, contract_id, created_at";

export type QuoteBrief = Pick<Quote, "id" | "request_id" | "tenant_id" | "status">;

/** 요청들의 견적(요청별 건수·선택 업체 표시용) */
export async function quotesFor(db: Db, requestIds: string[]): Promise<QuoteBrief[]> {
  if (requestIds.length === 0) return [];
  const { data } = await db.from("quote").select("id, request_id, tenant_id, status").in("request_id", requestIds);
  return (data ?? []) as QuoteBrief[];
}

export type RequestMessage = { id: string; tenant_id: string; sender: string; sender_id: string | null; body: string; created_at: string; read_at: string | null };
export const MESSAGE_SELECT = "id, tenant_id, sender, sender_id, body, created_at, read_at";

// ---------------------------------------------------------------- 정산
export type Settlement = {
  id: string;
  tenant_id: string;
  period_from: string;
  period_to: string;
  status: string;
  fee_total: number;
  ad_total: number;
  adjust_total: number;
  total: number;
  issued_at: string | null;
  paid_at: string | null;
  memo: string | null;
  created_at: string;
};
export const SETTLEMENT_SELECT = "id, tenant_id, period_from, period_to, status, fee_total, ad_total, adjust_total, total, issued_at, paid_at, memo, created_at";

export type SettlementLine = {
  id: string;
  kind: string;
  ref_type: string | null;
  ref_id: string | null;
  description: string;
  basis_amount: number;
  fee_amount: number;
  created_at: string;
};
export const LINE_SELECT = "id, kind, ref_type, ref_id, description, basis_amount, fee_amount, created_at";

// ---------------------------------------------------------------- 광고
export type Promotion = {
  id: string;
  tenant_id: string;
  kind: string;
  placement: string;
  category_code: string | null;
  starts_on: string;
  ends_on: string;
  price: number | null;
  status: string;
  note: string | null;
  decided_at: string | null;
  billed_settlement_id: string | null;
  created_at: string;
};
export const PROMOTION_SELECT = "id, tenant_id, kind, placement, category_code, starts_on, ends_on, price, status, note, decided_at, billed_settlement_id, created_at";

// ---------------------------------------------------------------- 건수
/** 상태별 건수(head count). 목록 칩·탭 배지용 */
export async function statusCounts(db: Db, table: string, statuses: readonly string[]): Promise<Record<string, number>> {
  const results = await Promise.all(statuses.map((s) => db.from(table).select("id", { count: "exact", head: true }).eq("status", s)));
  return Object.fromEntries(statuses.map((s, i) => [s, results[i].count ?? 0]));
}

/** 탭 배지: 심사 대기 신청 · 광고 신청 대기 */
export async function pendingCounts(db: Db): Promise<{ applications: number; promotions: number }> {
  const [a, p] = await Promise.all([
    db.from("vendor_application").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("vendor_promotion").select("id", { count: "exact", head: true }).eq("status", "requested"),
  ]);
  return { applications: a.count ?? 0, promotions: p.count ?? 0 };
}
