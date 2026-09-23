import type { SupabaseClient } from "@supabase/supabase-js";
import type { BadgeFamily } from "@/lib/contracts";

/**
 * 시공 사진·후기·콘텐츠 공용 라벨과 Storage 경로·서명 URL 도우미.
 * 서버 전용 import(next/headers 등)가 없어서 업로더(브라우저)도 라벨과 경로 생성기를 같이 쓴다.
 */

export const MEDIA_BUCKET = "media";

export const MEDIA_KIND: Record<string, string> = {
  before: "시공 전",
  after: "시공 후",
  process: "과정",
  issue: "문제",
  receipt: "영수증",
  review: "후기",
  other: "기타",
};
/** 업로더에서 고를 수 있는 종류. 후기 사진(review)은 후기에 붙는 것이라 뺀다. */
export const UPLOAD_KINDS = Object.keys(MEDIA_KIND).filter((k) => k !== "review");

export const REVIEW_CHANNEL: Record<string, string> = { app: "앱", kakao: "카카오", naver: "네이버", google: "구글", instagram: "인스타그램", manual: "직접 입력" };
export const REVIEW_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  pending: { label: "대기", badge: "wait" },
  approved: { label: "승인", badge: "done" },
  hidden: { label: "숨김", badge: "risk" },
};

export const POST_KIND: Record<string, string> = {
  instagram: "인스타그램",
  naver_blog: "네이버 블로그",
  kakao_channel: "카카오 채널",
  youtube_short: "유튜브 쇼츠",
  blog: "블로그",
  ad: "광고",
  other: "기타",
};
export const POST_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  draft: { label: "초안", badge: "wait" },
  ready: { label: "발행 준비", badge: "run" },
  published: { label: "발행됨", badge: "done" },
  archived: { label: "보관", badge: "wait" },
};

/** 별점 1~5 → "★★★★☆" (없으면 "—") */
export function stars(rating: number | null | undefined): string {
  const n = Math.round(Number(rating));
  if (!Number.isFinite(n) || n < 1) return "—";
  const k = Math.min(5, n);
  return "★".repeat(k) + "☆".repeat(5 - k);
}

/** "#입주청소, 줄눈 #코팅" → ["입주청소", "줄눈", "코팅"] (중복 제거, 최대 30개) */
export function parseHashtags(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (value ?? "").split(/[\s,]+/)) {
    const t = raw.replace(/^#+/, "").trim().slice(0, 50);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 30) break;
  }
  return out;
}

/** ["a","b"] → "#a #b" */
export function hashtagText(tags: string[] | null | undefined): string {
  return (tags ?? []).map((t) => `#${t}`).join(" ");
}

/** 본문 + 해시태그를 복사·붙여넣기용 한 덩어리로 */
export function postText(body: string | null | undefined, tags: string[] | null | undefined): string {
  return [body?.trim() ?? "", hashtagText(tags)].filter(Boolean).join("\n\n");
}

/** 한국 시간 기준 yyyymm (서버가 UTC 여도 월 폴더가 어긋나지 않게) */
function yyyymm(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7).replace("-", "");
}

/**
 * Storage 객체 경로 <tenant_id>/<yyyymm>/<uuid>.<ext>.
 * 첫 폴더가 tenant_id 여야 storage.objects 정책(폴더명 = 사업체 권한)을 통과한다.
 */
export function mediaPath(tenantId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
  return `${tenantId}/${yyyymm()}/${crypto.randomUUID()}.${safeExt}`;
}

/**
 * 비공개 버킷의 서명 URL 을 경로별로 한 번에 만든다 → Map<path, url>.
 * 경로가 없으면 호출하지 않고, 실패한 항목은 Map 에서 빠진다(화면은 빈 칸으로 그린다).
 */
export async function signedUrlMap(supabase: SupabaseClient, paths: string[], expires = 3600): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter((p) => typeof p === "string" && p.length > 0)));
  if (unique.length === 0) return map;
  try {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(unique, expires);
    if (error || !data) return map;
    for (const row of data) {
      if (row.path && row.signedUrl && !row.error) map.set(row.path, row.signedUrl);
    }
  } catch {
    // Storage 가 없거나(로컬 스텁) 네트워크 오류: 미리보기 없이 보여준다
  }
  return map;
}
