import type { SupabaseClient } from "@supabase/supabase-js";
import { REGIONS, VENDOR_CARD_SELECT, type QuoteItem, type VendorCard } from "@/lib/market";

/** 집대리 마켓 공개 페이지(로그인 없음)용 조회. 서비스 키 클라이언트로만 부른다 */

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
export const TOKEN_RE = /^[a-zA-Z0-9]{16,64}$/;

export type VendorFilter = { cat?: string; region?: string };

/** 노출 업체 카드 목록: 광고(상단 노출) → 평점(없으면 뒤) → 최근 노출 순 */
export async function vendorCards(admin: SupabaseClient, f: VendorFilter = {}): Promise<VendorCard[]> {
  let q = admin.from("vendor_card").select(VENDOR_CARD_SELECT);
  if (f.cat && /^[a-z_]+$/.test(f.cat)) q = q.contains("categories", [f.cat]);
  // 지역: 업체 시공 지역에 포함되거나, 지역 제한이 없는(빈 배열) 업체
  if (f.region && (REGIONS as readonly string[]).includes(f.region)) q = q.or(`regions.cs.{${f.region}},regions.eq.{}`);
  const { data } = await q
    .order("featured", { ascending: false })
    .order("rating", { ascending: false, nullsFirst: false })
    .order("listed_at", { ascending: false });
  return (data ?? []) as VendorCard[];
}

/** 업체 소개용 카드 한 장 (노출 중인 업체만). 없으면 null */
export async function vendorBySlug(admin: SupabaseClient, slug: string): Promise<VendorCard | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { data } = await admin.from("vendor_card").select(VENDOR_CARD_SELECT).eq("slug", slug).maybeSingle();
  return (data as VendorCard | null) ?? null;
}

/** 사업체 id 로 카드 (고객 요청 페이지에서 지목 업체 이름 표시용) */
export async function vendorByTenant(admin: SupabaseClient, tenantId: string): Promise<VendorCard | null> {
  const { data } = await admin.from("vendor_card").select(VENDOR_CARD_SELECT).eq("tenant_id", tenantId).maybeSingle();
  return (data as VendorCard | null) ?? null;
}

// ---- request_page(p_token) 가 돌려주는 JSON --------------------------------------------------

export type RequestPageRequest = {
  id: string;
  name: string;
  phone_tail: string | null;
  region: string;
  apt: string | null;
  address: string | null;
  area_pyeong: number | null;
  move_in_date: string | null;
  categories: string[];
  message: string | null;
  budget: number | null;
  status: "open" | "accepted" | "closed" | "canceled" | string;
  accepted_quote_id: string | null;
  phone_shared: boolean;
  expires_at: string;
  created_at: string;
  directed_tenant_id: string | null;
};

/** vendor_card 를 left join 하므로 노출이 꺼진 업체는 모든 값이 null 이다 */
export type RequestPageVendor = {
  slug: string | null;
  name: string | null;
  brand: Record<string, unknown> | null;
  rating: number | null;
  review_count: number | null;
  done_jobs: number | null;
  featured: boolean | null;
  highlights: string[] | null;
  response_note: string | null;
};

export type RequestPageQuote = {
  id: string;
  tenant_id: string;
  amount: number;
  items: QuoteItem[] | null;
  message: string | null;
  available_from: string | null;
  valid_until: string | null;
  status: "submitted" | "accepted" | "declined" | "withdrawn" | string;
  created_at: string;
  vendor: RequestPageVendor | null;
};

export type RequestPageMessage = {
  id: string;
  tenant_id: string;
  sender: "customer" | "vendor" | "platform";
  body: string;
  created_at: string;
};

export type RequestPage = {
  request: RequestPageRequest;
  quotes: RequestPageQuote[];
  messages: RequestPageMessage[];
  categories: Record<string, string>;
};

/** 고객 요청 페이지 자료. 토큰이 틀리면 null */
export async function requestPage(admin: SupabaseClient, token: string): Promise<RequestPage | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await admin.rpc("request_page", { p_token: token });
  if (error || !data) return null;
  const d = data as RequestPage;
  return { request: d.request, quotes: d.quotes ?? [], messages: d.messages ?? [], categories: d.categories ?? {} };
}
