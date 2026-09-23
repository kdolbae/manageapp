import type { BadgeFamily } from "@/lib/contracts";

/** 경비 상태 */
export const EXPENSE_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  draft: { label: "임시", badge: "wait" },
  submitted: { label: "청구됨", badge: "wait" },
  approved: { label: "승인", badge: "run" },
  rejected: { label: "반려", badge: "risk" },
  paid: { label: "지급", badge: "done" },
};

/** 정산서 상태 */
export const PAYOUT_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  draft: { label: "작성 중", badge: "wait" },
  confirmed: { label: "확정", badge: "run" },
  paid: { label: "지급", badge: "done" },
};

/** 시공자 정산 방식 */
export const RATE_TYPE: Record<string, string> = { rate_3_3: "3.3% 원천징수", daily: "일당", invoice: "계산서" };

/** 정산 줄 구분 */
export const PAYOUT_LINE_KIND: Record<string, string> = { job: "시공", daily: "일당", extra: "추가", deduct: "공제" };

/** YYYY-MM 꼴인가 */
export function isValidMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** 달 더하기: addMonths("2026-09", -1) → "2026-08" */
export function addMonths(ym: string, n: number): string {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-09" → "2026년 9월" */
export function monthLabel(ym: string): string {
  return `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
}
