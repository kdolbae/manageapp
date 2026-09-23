import type { BadgeFamily } from "@/lib/contracts";

/* ---------------------------------------------------------------------------
 * 그룹웨어(공지·결재·휴가) 라벨과 날짜 계산. 서버·클라이언트 어디서나 쓸 수 있게 순수 함수만 둔다.
 * ------------------------------------------------------------------------- */

export const APPROVAL_KIND: Record<string, string> = {
  general: "일반",
  purchase: "구매 요청",
  expense: "지출 결의",
  leave: "휴가",
  contract_cancel: "계약 취소",
  discount: "할인 승인",
  other: "기타",
};

export const APPROVAL_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  draft: { label: "작성 중", badge: "wait" },
  submitted: { label: "결재 중", badge: "run" },
  approved: { label: "승인", badge: "done" },
  rejected: { label: "반려", badge: "risk" },
  canceled: { label: "취소", badge: "wait" },
};

export const STEP_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  waiting: { label: "대기", badge: "wait" },
  pending: { label: "결재 차례", badge: "run" },
  approved: { label: "승인", badge: "done" },
  rejected: { label: "반려", badge: "risk" },
  skipped: { label: "건너뜀", badge: "wait" },
};

export const LEAVE_KIND: Record<string, string> = {
  annual: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  sick: "병가",
  family: "경조사",
  unpaid: "무급",
  other: "기타",
};

export const LEAVE_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  pending: { label: "대기", badge: "wait" },
  approved: { label: "승인", badge: "done" },
  rejected: { label: "반려", badge: "risk" },
  canceled: { label: "취소", badge: "wait" },
};

const DAY = 86_400_000;

/** 휴가 일수: 반차는 0.5, 그 외는 시작~끝(포함)에서 토·일을 뺀 날 수(최소 1). */
export function leaveDays(kind: string, start: string, end: string): number {
  if (kind === "half_am" || kind === "half_pm") return 0.5;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 1;
  let n = 0;
  for (let t = s; t <= e; t += DAY) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n += 1;
  }
  return Math.max(1, n);
}

/** 2 → "2일", 0.5 → "0.5일" */
export function daysText(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0일";
  return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}일`;
}

/** YYYY-MM 꼴인가 */
export function isValidMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** 달 더하기: addMonths("2026-09", -1) → "2026-08" */
export function addMonths(ym: string, n: number): string {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 달의 첫날·마지막날(YYYY-MM-DD) */
export function monthRange(ym: string): { start: string; end: string } {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}

/** "2026-09" → "2026년 9월" */
export function monthLabel(ym: string): string {
  return `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
}

/** timestamptz → 한국 시간 기준 YYYY-MM-DD */
export function ymdKST(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** 만료됐는가(expires_at 이 기준 시각보다 앞) */
export function isExpired(expiresAt: string | null | undefined, nowIso: string): boolean {
  return Boolean(expiresAt) && new Date(expiresAt as string).getTime() < new Date(nowIso).getTime();
}
