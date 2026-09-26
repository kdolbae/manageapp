import Link from "next/link";
import type { ReactNode } from "react";
import { type CodeValue, labelOf } from "@/lib/codes";

/** 시공자 정산 방식 */
export const RATE_LABEL: Record<string, string> = { rate_3_3: "3.3%", daily: "일용직", invoice: "계산서" };
export const RATE_OPTIONS: { value: string; label: string }[] = [
  { value: "rate_3_3", label: "3.3% 원천징수" },
  { value: "daily", label: "일용직" },
  { value: "invoice", label: "계산서" },
];

export function StatusBadge({
  status,
  labels = { active: "활동", inactive: "비활동" },
}: {
  status: string;
  labels?: { active: string; inactive: string };
}) {
  const on = status === "active";
  return <span className={"badge " + (on ? "badge-done" : "badge-wait")}>{on ? labels.active : labels.inactive}</span>;
}

/** 작업 단위(주방·욕실 등) 표식: 색 + 글자 + 라벨의 3중 단서 */
export function WorkAreaTags({ codes, values }: { codes: string[]; values: CodeValue[] }) {
  if (!codes?.length) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
      {codes.map((code) => {
        const v = values.find((x) => x.code === code);
        const label = v?.label ?? code;
        const mark = v?.color === "wa1" || v?.color === "wa2" ? v.color : null;
        return (
          <span key={code} className="inline-flex items-center gap-1 whitespace-nowrap">
            {mark && <span className={`mark mark-${mark}`}>{label.slice(0, 1)}</span>}
            {label}
          </span>
        );
      })}
    </span>
  );
}

/** 코드값 배지 목록(협력업체 유형 등) */
export function CodeBadges({ codes, values }: { codes: string[]; values: CodeValue[] }) {
  if (!codes?.length) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {codes.map((c) => (
        <span key={c} className="badge badge-wait">
          {labelOf(values, c)}
        </span>
      ))}
    </span>
  );
}

/** 체크박스 칩 묶음(작업 단위·협력업체 유형 고르기) */
export function CodeCheckboxes({
  name,
  values,
  selected,
  empty,
}: {
  name: string;
  values: CodeValue[];
  selected: string[];
  empty: string;
}) {
  if (!values.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <label key={v.code} className="chip">
          <input type="checkbox" name={name} value={v.code} defaultChecked={selected.includes(v.code)} />
          {v.label}
        </label>
      ))}
    </div>
  );
}

/** 상세 화면 위의 경로 표시 */
export function Crumb({ href, parent, current }: { href: string; parent: string; current: string }) {
  return (
    <div className="text-xs text-muted mb-3">
      <Link href={href}>{parent}</Link>
      <span className="mx-1.5">/</span>
      <span className="text-text font-medium">{current}</span>
    </div>
  );
}

/** 상세 요약의 라벨-값 한 줄 */
export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 border-b border-border last:border-0 text-sm">
      <div className="w-[96px] shrink-0 text-xs text-muted pt-0.5">{k}</div>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

export function NoPermission({ what }: { what: string }) {
  return <p className="text-sm text-muted">{what} 정보를 볼 수 있는 권한이 없습니다.</p>;
}

/** 협력업체 상태 라벨 */
export const PARTNER_STATUS = { active: "거래 중", inactive: "거래 중지" };

/** 수수료율 표시: 3.3 → "3.3%". 비어 있으면 "". */
export function rateText(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })}%` : String(value);
}
