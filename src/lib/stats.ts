/** 집계 화면(모니터링·영업 분석)에서 쓰는 작은 도우미. DB 집계 대신 행을 받아 서버에서 묶는다(수천 건까지는 충분). */
export function sum<T>(rows: T[], pick: (r: T) => number | null | undefined): number {
  let s = 0;
  for (const r of rows) s += Number(pick(r) ?? 0);
  return s;
}

export function groupBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r) ?? "";
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** 0~100 정수 퍼센트. 분모 0 이면 null. */
export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

export function pctText(part: number, whole: number): string {
  const p = pct(part, whole);
  return p === null ? "—" : `${p}%`;
}

/** 이번 달 1일 (YYYY-MM-01) */
export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** 달 마지막 날 */
export function monthEnd(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** 같은 길이의 직전 기간 */
export function prevPeriod(from: string, to: string): { from: string; to: string } {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  const days = Math.round((b - a) / 86_400_000) + 1;
  const pf = new Date(a - days * 86_400_000).toISOString().slice(0, 10);
  const pt = new Date(a - 86_400_000).toISOString().slice(0, 10);
  return { from: pf, to: pt };
}

/** 변화율 표시: +12% / -3% / — */
export function deltaText(now: number, before: number): string {
  if (!before) return now ? "신규" : "—";
  const d = Math.round(((now - before) / before) * 100);
  return `${d > 0 ? "+" : ""}${d}%`;
}

/** 월요일 시작 주 키(YYYY-MM-DD) */
export function weekKey(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
