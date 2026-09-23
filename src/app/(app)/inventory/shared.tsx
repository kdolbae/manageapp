import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { voidMove } from "@/lib/actions/inventory";
import { MOVE_KIND, WAREHOUSE_KIND, itemLabel, qtyText, reasonLabel, type MoveKind } from "@/lib/inventory";
import { mmdd } from "@/lib/dates";
import type { InvItem, MoveRow, Warehouse } from "./data";

export function NoPermission({ what = "자재·창고" }: { what?: string }) {
  return <p className="p-4 text-sm text-muted">{what} 권한이 없습니다.</p>;
}

export function KindBadge({ kind, voided }: { kind: string; voided?: boolean }) {
  const k = MOVE_KIND[kind as MoveKind] ?? { label: kind, badge: "wait" as const };
  return <span className={`badge badge-${voided ? "risk" : k.badge}`}>{k.label}{voided ? " · 취소됨" : ""}</span>;
}

export function WarehouseKindBadge({ kind }: { kind: string }) {
  return <span className={`badge ${kind === "vehicle" ? "badge-run" : "badge-wait"}`}>{WAREHOUSE_KIND[kind] ?? kind}</span>;
}

/** 품목 select 의 optgroup 들. stockOf 를 주면 이름 옆에 재고를 붙인다. */
export function ItemOptions({ groups, stockOf }: { groups: { code: string; label: string; items: InvItem[] }[]; stockOf?: (item: InvItem) => number | null }) {
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.code || "etc"} label={g.label}>
          {g.items.map((i) => {
            const s = stockOf ? stockOf(i) : null;
            return (
              <option key={i.id} value={i.id}>
                {itemLabel(i)}
                {s !== null ? ` · 재고 ${qtyText(s)}${i.unit !== "EA" ? i.unit : ""}` : ""}
              </option>
            );
          })}
        </optgroup>
      ))}
    </>
  );
}

export function WarehouseOptions({ list, empty }: { list: Warehouse[]; empty?: string }) {
  return (
    <>
      {empty !== undefined && <option value="">{empty}</option>}
      {list.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
          {w.kind === "vehicle" ? " (차량)" : w.is_default ? " (기본)" : ""}
        </option>
      ))}
    </>
  );
}

/** 창고 표시: 입고 "→ 본사", 출고 "본사 →", 이동 "본사 → 차량". */
export function moveRoute(m: MoveRow) {
  const from = m.from_wh?.name;
  const to = m.to_wh?.name;
  if (from && to) return `${from} → ${to}`;
  if (from) return `${from} →`;
  if (to) return `→ ${to}`;
  return "";
}

/** 거래처·현장 칸: 계약번호 링크, 없으면 거래처(협력업체 또는 이름). */
export function MoveRef({ m }: { m: MoveRow }) {
  return (
    <>
      {m.contract_id && m.contract?.contract_no && (
        <Link href={`/contracts/${m.contract_id}`} className="mono text-xs">
          {m.contract.contract_no}
        </Link>
      )}
      {m.contract_id && !m.contract?.contract_no && <span className="text-xs text-muted">시공 건</span>}
      {(m.partner?.name || m.partner_name) && <span className={m.contract_id ? "ml-1 text-xs text-muted" : ""}>{m.partner?.name ?? m.partner_name}</span>}
      {m.doc_no && <span className="mono text-xs text-muted ml-1">{m.doc_no}</span>}
      {!m.contract_id && !m.partner?.name && !m.partner_name && !m.doc_no && <span className="zero">—</span>}
    </>
  );
}

/** 취소 폼 (사유 필수). 내역은 고칠 수 없고 취소만 된다. */
export function VoidDetails({ id, label = "취소" }: { id: string; label?: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-danger text-xs">{label}</summary>
      <ActionForm action={voidMove} className="mt-2 grid gap-2 min-w-[200px]">
        <input type="hidden" name="id" value={id} />
        <input name="void_reason" required maxLength={200} placeholder="취소 사유 (필수)" className="field" aria-label="취소 사유" />
        <SubmitButton className="btn btn-sm btn-danger">취소 확정</SubmitButton>
      </ActionForm>
    </details>
  );
}

/** 출고·입고 화면 아래의 최근 내역 (간단 표). canVoid(m) 가 true 인 줄에 취소 폼을 붙인다. */
export function RecentMoves({ rows, canVoid, empty = "아직 기록이 없습니다." }: { rows: MoveRow[]; canVoid: (m: MoveRow) => boolean; empty?: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>일자</th>
            <th>구분</th>
            <th>품목</th>
            <th className="text-right">수량</th>
            <th>창고</th>
            <th>사유 · 현장</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className={m.voided_at ? "opacity-60" : ""}>
              <td className="mono text-xs whitespace-nowrap">{mmdd(m.moved_on)}</td>
              <td>
                <KindBadge kind={m.kind} voided={Boolean(m.voided_at)} />
              </td>
              <td className="font-semibold whitespace-nowrap">{m.item ? itemLabel(m.item) : "(품목 없음)"}</td>
              <td className={`num ${m.voided_at ? "line-through" : ""}`}>
                {qtyText(m.qty)} <span className="text-muted text-xs font-normal">{m.item?.unit}</span>
              </td>
              <td className="text-xs whitespace-nowrap">{moveRoute(m)}</td>
              <td className="text-xs">
                {reasonLabel(m.reason)} <MoveRef m={m} />
                {m.note && <div className="text-muted">{m.note}</div>}
                {m.voided_at && <div className="text-danger">취소: {m.void_reason}</div>}
              </td>
              <td>{!m.voided_at && canVoid(m) && <VoidDetails id={m.id} />}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-muted py-6">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
