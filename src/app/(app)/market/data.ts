import type { Db } from "@/app/(app)/people/data";
import { MARKET_REQUEST_SELECT, type MarketRequest, type QuoteItem } from "@/lib/market";

/* 집대리 마켓(업체 쪽) 화면들이 같이 쓰는 조회·계산. 서버 컴포넌트에서만 부른다. */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VendorProfile = {
  tenant_id: string;
  categories: string[];
  regions: string[];
  intro: string | null;
  highlights: string[];
  logo_path: string | null;
  cover_path: string | null;
  min_price: number | null;
  response_note: string | null;
  is_listed: boolean;
  listed_at: string | null;
  created_at: string;
  updated_at: string;
};
const VENDOR_PROFILE_SELECT = "tenant_id, categories, regions, intro, highlights, logo_path, cover_path, min_price, response_note, is_listed, listed_at, created_at, updated_at";

/** 우리 사업체의 업체 소개. 없으면 null (아직 등록 전). */
export async function myVendorProfile(db: Db, tenantId: string): Promise<VendorProfile | null> {
  const { data } = await db.from("vendor_profile").select(VENDOR_PROFILE_SELECT).eq("tenant_id", tenantId).maybeSingle();
  return (data as VendorProfile | null) ?? null;
}

export type MyQuote = {
  id: string;
  request_id: string;
  amount: number;
  items: QuoteItem[];
  message: string | null;
  available_from: string | null;
  valid_until: string | null;
  status: string;
  contract_id: string | null;
  created_at: string;
  updated_at: string;
};
export const QUOTE_SELECT = "id, request_id, amount, items, message, available_from, valid_until, status, contract_id, created_at, updated_at";

/** jsonb items → 품목 배열 (모양이 어긋난 값은 버린다) */
export function normalizeItems(v: unknown): QuoteItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i) => ({ name: String(i.name ?? ""), qty: Number(i.qty ?? 0), unit_price: Number(i.unit_price ?? 0) }))
    .filter((i) => i.name);
}

const withItems = (q: Record<string, unknown>): MyQuote => ({ ...(q as unknown as MyQuote), items: normalizeItems(q.items) });

/** 우리 사업체 견적. requestIds 를 주면 그 요청들 것만. */
export async function myQuotes(db: Db, tenantId: string, requestIds?: string[]): Promise<MyQuote[]> {
  if (requestIds && requestIds.length === 0) return [];
  let q = db.from("quote").select(QUOTE_SELECT).eq("tenant_id", tenantId);
  if (requestIds) q = q.in("request_id", requestIds);
  const { data } = await q.order("created_at", { ascending: false }).limit(500);
  return ((data ?? []) as Record<string, unknown>[]).map(withItems);
}

/** 이 요청에 대한 우리 견적 (요청 × 업체 = 하나) */
export async function myQuoteFor(db: Db, tenantId: string, requestId: string): Promise<MyQuote | null> {
  const { data } = await db.from("quote").select(QUOTE_SELECT).eq("tenant_id", tenantId).eq("request_id", requestId).maybeSingle();
  return data ? withItems(data as Record<string, unknown>) : null;
}

/** 지금 견적을 받는 중인(열려 있고 마감 전) 요청 수 — 뷰가 우리 업체에 보이는 것만 센다 */
export async function openRequestCount(db: Db, nowIso: string): Promise<number> {
  const { count } = await db.from("market_request").select("id", { count: "exact", head: true }).eq("status", "open").gt("expires_at", nowIso);
  return count ?? 0;
}

/** 요청 여러 건 (내 견적 목록에 요청 요약을 붙일 때). 뷰는 FK 가 없어 PostgREST 임베드가 안 되므로 따로 조회한다. */
export async function requestsByIds(db: Db, ids: string[]): Promise<MarketRequest[]> {
  if (ids.length === 0) return [];
  const { data } = await db.from("market_request").select(MARKET_REQUEST_SELECT).in("id", ids);
  return (data ?? []) as MarketRequest[];
}

export type RequestMessage = { id: string; sender: string; sender_id: string | null; body: string; created_at: string; read_at: string | null };
export const SENDER_LABEL: Record<string, string> = { customer: "고객", vendor: "우리", platform: "집대리" };

/** "대구 수성구 힐스테이트" 꼴 제목 */
export const requestTitle = (r: Pick<MarketRequest, "region" | "apt">) => `${r.region}${r.apt ? ` ${r.apt}` : ""}`;

/** 열려 있고 마감 전인가 (견적 제출·수정 가능) */
export const isOpen = (r: Pick<MarketRequest, "status" | "expires_at">, nowIso: string) =>
  r.status === "open" && new Date(r.expires_at).getTime() > new Date(nowIso).getTime();

/** 마감까지 남은 날 (올림). 지났으면 음수. */
export const daysLeft = (expiresAt: string, nowIso: string) => Math.ceil((new Date(expiresAt).getTime() - new Date(nowIso).getTime()) / 86_400_000);

/** 마감 표시: D-3 · 오늘 마감 · 마감됨 */
export function deadlineText(r: Pick<MarketRequest, "status" | "expires_at">, nowIso: string): string {
  if (r.status !== "open") return "";
  const d = daysLeft(r.expires_at, nowIso);
  if (d < 0) return "마감됨";
  if (d === 0) return "오늘 마감";
  return `D-${d}`;
}
