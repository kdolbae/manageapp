import type { Prisma } from "@prisma/client";

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

/** 금액 포맷 (원화 기본). Prisma Decimal/number/string 모두 허용. */
export function formatMoney(value: DecimalLike, currency = "KRW"): string {
  if (value === null || value === undefined) return "-";
  const num = typeof value === "object" ? Number(value.toString()) : Number(value);
  if (Number.isNaN(num)) return "-";
  if (currency === "KRW") {
    return `${num.toLocaleString("ko-KR")}원`;
  }
  return `${num.toLocaleString("ko-KR")} ${currency}`;
}

/** 숫자화 (Decimal → number) */
export function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "object" ? Number(value.toString()) : Number(value);
}

/** 날짜 포맷 YYYY-MM-DD */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toISOString().slice(0, 10);
}

/** 오늘 기준 남은 일수 (음수면 지남) */
export function daysUntil(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** form의 문자열 값을 Date | null 로 */
export function parseDate(v: FormDataEntryValue | null): Date | null {
  if (!v || typeof v !== "string" || v.trim() === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** form의 문자열 값을 number | null 로 */
export function parseNumber(v: FormDataEntryValue | null): number | null {
  if (v === null || typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

/** form의 문자열 값을 string | null 로 (빈 값은 null) */
export function parseString(v: FormDataEntryValue | null): string | null {
  if (v === null || typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
