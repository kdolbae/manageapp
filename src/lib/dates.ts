/** 한국 시간 기준 오늘(YYYY-MM-DD). 서버는 UTC 로 돌 수 있으므로 Asia/Seoul 로 고정한다. */
export function todayKST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
export function weekday(ymd: string): string {
  return WEEKDAY[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
}

export function mmdd(ymd: string): string {
  return `${ymd.slice(5, 7)}.${ymd.slice(8, 10)}`;
}

export function isValidYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}
