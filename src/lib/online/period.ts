import { addDays, isValidYmd, todayKST } from "@/lib/dates";

export const MAX_DAYS = 366;

/** 한국 날짜 기간. 기본 최근 30일, 오늘을 넘지 않고, 최대 366일(넘으면 끝에서 366일로 자른다). */
export function clampPeriod(fromIn: unknown, toIn: unknown): { from: string; to: string; clipped: boolean } {
  const today = todayKST();
  let to = isValidYmd(toIn) && toIn <= today ? toIn : today;
  let from = isValidYmd(fromIn) ? fromIn : addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  const earliest = addDays(to, -(MAX_DAYS - 1));
  const clipped = from < earliest;
  if (clipped) from = earliest;
  return { from, to, clipped };
}

/** 한국 날짜 from~to 를 UTC 경계로: [gte, lt) */
export function kstBounds(from: string, to: string): { gte: string; lt: string } {
  return { gte: new Date(`${from}T00:00:00+09:00`).toISOString(), lt: new Date(`${addDays(to, 1)}T00:00:00+09:00`).toISOString() };
}

export const kstDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
