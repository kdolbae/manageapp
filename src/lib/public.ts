import type { SupabaseClient } from "@supabase/supabase-js";

export type Brand = { app_name?: string | null; color?: string | null; phone?: string | null; tagline?: string | null; address?: string | null; kakao_url?: string | null; instagram_url?: string | null };
export type PublicTenant = { id: string; name: string; slug: string; brand: Brand };

/** 브랜드 페이지용 사업체 (서비스 키). 없으면 null */
export async function publicTenant(admin: SupabaseClient, slug: string): Promise<PublicTenant | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) return null;
  const { data } = await admin.from("tenant").select("id, name, slug, brand").eq("slug", slug).eq("status", "active").is("deleted_at", null).maybeSingle();
  return (data as PublicTenant | null) ?? null;
}

/** 브랜드 색을 CSS 변수로 (잘못된 값이면 기본색 유지) */
export function brandStyle(brand: Brand): React.CSSProperties {
  const color = brand.color && /^#[0-9a-fA-F]{6}$/.test(brand.color) ? brand.color : null;
  return color ? ({ "--accent": color } as React.CSSProperties) : {};
}

export async function signedUrlMap(admin: SupabaseClient, paths: string[], expires = 3600): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data } = await admin.storage.from("media").createSignedUrls(paths, expires);
  for (const r of data ?? []) if (r.path && r.signedUrl) map.set(r.path, r.signedUrl);
  return map;
}

export const STAR = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
