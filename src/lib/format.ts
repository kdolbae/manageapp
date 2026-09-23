/** 원 단위 금액: 1,234,567 (음수·소수 없음). null/0 은 "0". */
export function won(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("ko-KR");
}

/** 숫자만 저장된 전화번호를 010-1234-5678 꼴로. */
export function phone(value: string | null | undefined): string {
  if (!value) return "";
  const d = value.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return d.startsWith("02") ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return value;
}

/** 2026-09-23 → 09.23 (같은 해) / 25.09.23 (다른 해) */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() === new Date().getFullYear() ? `${mm}.${dd}` : `${String(d.getFullYear()).slice(2)}.${mm}.${dd}`;
}

/** 계좌번호 가리기: 110-***-***333 */
export function maskAccount(value: string | null | undefined): string {
  if (!value) return "";
  const d = value.replace(/\s/g, "");
  if (d.length <= 4) return "****";
  return d.slice(0, 3) + "*".repeat(Math.max(3, d.length - 6)) + d.slice(-3);
}
