import type { BadgeFamily } from "@/lib/contracts";

export const INQUIRY_STATUS: Record<string, { label: string; badge: BadgeFamily }> = {
  new: { label: "새 문의", badge: "risk" },
  contacted: { label: "연락함", badge: "run" },
  quoted: { label: "견적 냄", badge: "run" },
  converted: { label: "계약 전환", badge: "done" },
  closed: { label: "종료", badge: "wait" },
  spam: { label: "스팸", badge: "wait" },
};
export const INQUIRY_CHANNEL: Record<string, string> = { web: "홈페이지", phone: "전화", kakao: "카카오", partner: "협력업체", walk_in: "방문", fair: "박람회", other: "기타" };
export const CONSULT_CHANNEL: Record<string, string> = { call: "전화", sms: "문자", kakao: "카카오톡", visit: "방문", email: "메일", memo: "메모" };

export function fmtDateTime(v: string) {
  const d = new Date(v);
  const k = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${String(k.getMonth() + 1).padStart(2, "0")}.${String(k.getDate()).padStart(2, "0")} ${String(k.getHours()).padStart(2, "0")}:${String(k.getMinutes()).padStart(2, "0")}`;
}

/** 접수 뒤 지난 시간(분). 목록에서 "1시간 넘게 미응답" 표시용. */
export function minutesSince(v: string) {
  return (Date.now() - new Date(v).getTime()) / 60_000;
}
