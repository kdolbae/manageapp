import { MEDIA_KIND } from "@/lib/media";

/** 서명된 비공개 URL(1시간짜리)이라 next/image 최적화를 거치지 않고 <img> 로 그린다. */
export function Thumb({ src, alt, className = "" }: { src: string | undefined; alt: string; className?: string }) {
  if (!src) return <div className={`aspect-square bg-zebra flex items-center justify-center text-[11px] text-muted ${className}`}>미리보기 없음</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={`block w-full aspect-square object-cover bg-zebra ${className}`} />;
}

const KIND_BADGE: Record<string, string> = { before: "badge-run", after: "badge-done", issue: "badge-risk" };

export function KindBadge({ kind }: { kind: string }) {
  return <span className={`badge ${KIND_BADGE[kind] ?? "badge-wait"}`}>{MEDIA_KIND[kind] ?? kind}</span>;
}
