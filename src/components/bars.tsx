import { won } from "@/lib/format";

export type BarRow = { key: string; label: React.ReactNode; value: number; sub?: React.ReactNode; href?: string };

/** 가로 막대 목록(서버 컴포넌트). value 는 원 단위 금액 또는 건수. */
export function Bars({ rows, unit = "count", max, empty = "자료가 없습니다." }: { rows: BarRow[]; unit?: "count" | "won"; max?: number; empty?: string }) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="grid gap-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate">{r.label}</span>
          <span className="h-3 rounded-sm bg-bg overflow-hidden"><span className="block h-full bg-accent" style={{ width: `${top ? Math.max(2, Math.round((r.value / top) * 100)) : 0}%` }} /></span>
          <span className="num text-xs whitespace-nowrap">{unit === "won" ? `${won(r.value)}원` : `${r.value}건`}{r.sub && <span className="text-muted ml-1">{r.sub}</span>}</span>
        </li>
      ))}
    </ul>
  );
}
