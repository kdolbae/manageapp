import type { SupabaseClient } from "@supabase/supabase-js";

/** 집대리 플랫폼(마켓) 공용 타입·라벨. 서버·클라이언트 어디서나 import 가능 (DB 호출 함수만 서버에서 쓴다) */

export type PlatformCategory = { code: string; label: string; sort_order: number; is_active: boolean };

export const REGIONS = ["서울", "경기", "인천", "부산", "대구", "경북", "경남", "대전", "충남", "충북", "광주", "전남", "전북", "울산", "강원", "제주", "세종"] as const;

export type Badge = "run" | "done" | "wait" | "risk";
type Status = { label: string; badge: Badge };

export const REQUEST_STATUS: Record<string, Status> = {
  open: { label: "견적 받는 중", badge: "run" },
  accepted: { label: "업체 선택됨", badge: "done" },
  closed: { label: "마감", badge: "wait" },
  canceled: { label: "취소", badge: "wait" },
};

export const QUOTE_STATUS: Record<string, Status> = {
  submitted: { label: "제출됨", badge: "run" },
  accepted: { label: "선택됨", badge: "done" },
  declined: { label: "미선택", badge: "wait" },
  withdrawn: { label: "철회", badge: "wait" },
};

export const APPLICATION_STATUS: Record<string, Status> = {
  pending: { label: "심사 대기", badge: "run" },
  approved: { label: "승인", badge: "done" },
  rejected: { label: "반려", badge: "risk" },
};

export const PROMOTION_STATUS: Record<string, Status> = {
  requested: { label: "신청", badge: "run" },
  approved: { label: "승인", badge: "done" },
  rejected: { label: "반려", badge: "risk" },
  canceled: { label: "취소", badge: "wait" },
};

export const SETTLEMENT_STATUS: Record<string, Status> = {
  draft: { label: "작성 중", badge: "wait" },
  issued: { label: "발행", badge: "run" },
  paid: { label: "입금 완료", badge: "done" },
  void: { label: "무효", badge: "risk" },
};

export const FEE_TYPE: Record<string, string> = { percent: "계약금액 %", fixed: "건당 정액", none: "없음" };
export const FEE_CYCLE: Record<string, string> = { monthly: "월말 정산", per_case: "건별 정산" };
export const PROMOTION_KIND: Record<string, string> = { featured: "상단 노출", banner: "배너" };
export const PLACEMENT: Record<string, string> = { home: "첫 화면", category: "분류 화면" };

export type QuoteItem = { name: string; qty: number; unit_price: number };

export function quoteTotal(items: QuoteItem[]): number {
  return items.reduce((s, i) => s + Math.round((Number(i.qty) || 0) * (Number(i.unit_price) || 0)), 0);
}

export type PlatformFee = { fee_type: string; rate: number; fixed_amount: number; min_fee: number | null; max_fee: number | null };

/** 정산 함수(build_platform_settlement)와 같은 규칙으로 계산한 예상 수수료 */
export function feeFor(fee: PlatformFee, basis: number): number {
  let v = fee.fee_type === "percent" ? Math.round((basis * Number(fee.rate)) / 100) : fee.fee_type === "fixed" ? Number(fee.fixed_amount) : 0;
  if (fee.min_fee != null && v < Number(fee.min_fee)) v = Number(fee.min_fee);
  if (fee.max_fee != null && v > Number(fee.max_fee)) v = Number(fee.max_fee);
  return v;
}

/** 김서연 → 김*연 (DB 의 app.mask_name 과 동일) */
export function maskName(n: string | null | undefined): string {
  if (!n) return "고객";
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0] + "*";
  return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
}

export function categoryLabels(codes: string[] | null | undefined, cats: Pick<PlatformCategory, "code" | "label">[]): string {
  const map = new Map(cats.map((c) => [c.code, c.label]));
  return (codes ?? []).map((c) => map.get(c) ?? c).join(" · ");
}

/** 서비스 분류표 (로그인 사용자·서비스 키 모두 조회 가능) */
export async function platformCategories(supabase: SupabaseClient, onlyActive = true): Promise<PlatformCategory[]> {
  let q = supabase.from("platform_category").select("code, label, sort_order, is_active").order("sort_order");
  if (onlyActive) q = q.eq("is_active", true);
  const { data } = await q;
  return (data ?? []) as PlatformCategory[];
}

export type PlatformContext = { operatorTenantId: string | null; platformName: string; isPlatformAdmin: boolean };

/** 운영사 지정 여부와 현재 사용자가 운영자인지 (운영사 사업체로 접속 중 + platform.manage) */
export async function platformContext(supabase: SupabaseClient, currentTenantId: string | null, can: (p: string) => boolean): Promise<PlatformContext> {
  const { data } = await supabase.from("platform").select("operator_tenant_id, name").eq("id", 1).maybeSingle();
  const operatorTenantId = (data?.operator_tenant_id as string | undefined) ?? null;
  return {
    operatorTenantId,
    platformName: (data?.name as string | undefined) ?? "집대리",
    isPlatformAdmin: Boolean(operatorTenantId && currentTenantId === operatorTenantId && can("platform.manage")),
  };
}

/** 뷰 market_request 의 행 (업체가 보는 요청: 이름 가림, 연락처는 선택된 업체에만) */
export type MarketRequest = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  region: string;
  apt: string | null;
  area_pyeong: number | null;
  move_in_date: string | null;
  categories: string[];
  message: string | null;
  budget: number | null;
  expires_at: string;
  directed_tenant_id: string | null;
  accepted_quote_id: string | null;
  accepted_tenant_id: string | null;
  name_masked: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_address: string | null;
};

export const MARKET_REQUEST_SELECT =
  "id, created_at, updated_at, status, region, apt, area_pyeong, move_in_date, categories, message, budget, expires_at, directed_tenant_id, accepted_quote_id, accepted_tenant_id, name_masked, contact_name, contact_phone, contact_address";

export type VendorCard = {
  tenant_id: string;
  slug: string;
  name: string;
  brand: Record<string, unknown>;
  categories: string[];
  regions: string[];
  intro: string | null;
  highlights: string[];
  logo_path: string | null;
  cover_path: string | null;
  min_price: number | null;
  response_note: string | null;
  listed_at: string | null;
  rating: number | null;
  review_count: number;
  done_jobs: number;
  featured: boolean;
};

export const VENDOR_CARD_SELECT =
  "tenant_id, slug, name, brand, categories, regions, intro, highlights, logo_path, cover_path, min_price, response_note, listed_at, rating, review_count, done_jobs, featured";
