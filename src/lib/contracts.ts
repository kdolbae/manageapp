/** 계약·시공·원장 상태 표시용 라벨과 배지 계열 (4계열: wait / run / done / risk). */

export type BadgeFamily = "wait" | "run" | "done" | "risk";

export const CONTRACT_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  pending_approval: { label: "승인대기", badge: "wait" },
  rejected: { label: "반려", badge: "risk" },
  canceled: { label: "취소", badge: "risk" },
  no_job: { label: "시공 없음", badge: "wait" },
  undecided: { label: "시공미정", badge: "wait" },
  scheduled: { label: "시공대기", badge: "wait" },
  in_progress: { label: "시공중", badge: "run" },
  postponed: { label: "시공연기", badge: "wait" },
  done: { label: "시공완료", badge: "done" },
};

export const JOB_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  undecided: { label: "미정", badge: "wait" },
  scheduled: { label: "예정", badge: "wait" },
  assigned: { label: "배정", badge: "run" },
  in_progress: { label: "시공중", badge: "run" },
  done: { label: "완료", badge: "done" },
  postponed: { label: "연기", badge: "wait" },
  canceled: { label: "취소", badge: "risk" },
};

export const JOB_KIND: Record<string, string> = { install: "시공", as: "AS", repair: "하자보수" };
export const TIME_SLOT: Record<string, string> = { any: "무관", am: "오전", pm: "오후" };
export const APPROVAL: Record<string, { label: string; badge: BadgeFamily }> = {
  pending: { label: "승인대기", badge: "wait" },
  approved: { label: "승인", badge: "done" },
  rejected: { label: "반려", badge: "risk" },
};

export const LEDGER_TYPE: Record<string, { label: string; side: "sale" | "payment"; sign: 1 | -1 }> = {
  deposit: { label: "계약금", side: "payment", sign: 1 },
  interim: { label: "중도금", side: "payment", sign: 1 },
  balance: { label: "잔금", side: "payment", sign: 1 },
  refund: { label: "환불", side: "payment", sign: -1 },
  discount: { label: "할인", side: "sale", sign: -1 },
  voucher: { label: "상품권", side: "sale", sign: -1 },
  sales_cancel: { label: "매출취소", side: "sale", sign: -1 },
  adjust: { label: "금액조정(+)", side: "sale", sign: 1 },
};

export function statusBadge(status: string | null | undefined) {
  const s = CONTRACT_STATUS[status ?? ""] ?? { label: status ?? "", badge: "wait" as BadgeFamily };
  return s;
}

/** 작업 단위 색 토큰: code_value.color 가 'wa1'/'wa2' 면 그 계열, 아니면 순서로 배정. */
export function workAreaClass(color: string | null | undefined, index: number) {
  if (color === "wa1" || color === "wa2") return color;
  return index % 2 === 0 ? "wa1" : "wa2";
}
