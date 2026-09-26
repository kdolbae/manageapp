import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { todayKST, isValidYmd, mmdd } from "@/lib/dates";
import { MOVE_KIND, MOVE_KINDS, itemLabel, qtyText, reasonLabel } from "@/lib/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { updateMoveAmount } from "@/lib/actions/inventory";
import { amountOf, loadItems, loadWarehouses, technicianOptions, MOVE_SELECT, MOVE_AMOUNT_SELECT, type MoveRow } from "../data";
import { KindBadge, MoveRef, NoPermission, VoidDetails, moveRoute } from "../shared";

export const metadata = { title: "입출고 내역" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pickUuid = (v: string | string[] | undefined) => (typeof v === "string" && UUID.test(v) ? v : "");

function monthRange(ymd: string, offset: number) {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}

export default async function MovesPage({ searchParams }: PageProps<"/inventory/moves">) {
  const session = await requireTenant();
  if (!session.can("inventory.read")) return <NoPermission />;
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const today = todayKST();
  const from = isValidYmd(sp.from) ? sp.from : today.slice(0, 8) + "01";
  const to = isValidYmd(sp.to) ? sp.to : today;
  const kind = typeof sp.kind === "string" && MOVE_KINDS.includes(sp.kind as (typeof MOVE_KINDS)[number]) ? sp.kind : "";
  const item = pickUuid(sp.item);
  const wh = pickUuid(sp.wh);
  const tech = pickUuid(sp.tech);
  const canPrice = session.can("inventory.price");
  const canMove = session.can("inventory.move");
  const supabase = await createClient();

  let query = supabase
    .from("inv_move")
    .select(MOVE_SELECT + (canPrice ? MOVE_AMOUNT_SELECT : ""))
    .eq("tenant_id", tid)
    .gte("moved_on", from)
    .lte("moved_on", to);
  if (kind) query = query.eq("kind", kind);
  if (item) query = query.eq("item_id", item);
  if (wh) query = query.or(`from_warehouse_id.eq.${wh},to_warehouse_id.eq.${wh}`);
  if (tech) query = query.eq("technician_id", tech);

  const [{ data }, items, warehouses, technicians] = await Promise.all([
    query.order("moved_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    loadItems(supabase, tid, true),
    loadWarehouses(supabase, tid, true),
    technicianOptions(supabase, tid),
  ]);
  const list = (data ?? []) as unknown as MoveRow[];
  const live = list.filter((m) => !m.voided_at);
  const qtyBy = (k: string) => live.filter((m) => m.kind === k).reduce((s, m) => s + Number(m.qty), 0);
  const adjPlus = live.filter((m) => m.kind === "adjust" && m.to_wh).reduce((s, m) => s + Number(m.qty), 0);
  const adjMinus = live.filter((m) => m.kind === "adjust" && m.from_wh).reduce((s, m) => s + Number(m.qty), 0);
  const sumAmt = (k: string, f: "supply_amount" | "vat_amount") => live.filter((m) => m.kind === k).reduce((s, m) => s + Number(amountOf(m)?.[f] ?? 0), 0);
  const canVoid = (m: MoveRow) => canMove && !m.voided_at && (canPrice || m.created_by === session.user.id);
  const cols = 10 + (canPrice ? 3 : 0) + (canMove ? 1 : 0);
  const prev = monthRange(from, -1);
  const next = monthRange(from, 1);
  const keep = (over: Record<string, string>) => {
    const s = new URLSearchParams({ from, to, kind, item, wh, tech, ...over });
    for (const [k, v] of Array.from(s.entries())) if (!v) s.delete(k);
    return `/inventory/moves?${s.toString()}`;
  };

  return (
    <div>
      <form method="get" className="flex flex-wrap items-end gap-2 px-3.5 py-2.5 bg-bg border-b border-border">
        <div><label className="label">시작</label><input type="date" name="from" defaultValue={from} className="field h-8 text-xs mono" /></div>
        <div><label className="label">끝</label><input type="date" name="to" defaultValue={to} className="field h-8 text-xs mono" /></div>
        <div>
          <label className="label">구분</label>
          <select name="kind" defaultValue={kind} className="field h-8 text-xs">
            <option value="">전체</option>
            {MOVE_KINDS.map((k) => <option key={k} value={k}>{MOVE_KIND[k].label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">품목</label>
          <select name="item" defaultValue={item} className="field h-8 text-xs max-w-[200px]">
            <option value="">전체</option>
            {items.map((i) => <option key={i.id} value={i.id}>{itemLabel(i)}{i.status !== "active" ? " (중지)" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="label">창고</label>
          <select name="wh" defaultValue={wh} className="field h-8 text-xs">
            <option value="">전체</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">시공자</label>
          <select name="tech" defaultValue={tech} className="field h-8 text-xs">
            <option value="">전체</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="btn btn-sm">조회</button>
        <Link href={keep(prev)} className="btn btn-sm">지난달</Link>
        <Link href={keep(monthRange(today, 0))} className="btn btn-sm">이번 달</Link>
        <Link href={keep(next)} className="btn btn-sm">다음달</Link>
      </form>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>일자</th>
              <th>구분</th>
              <th>품목</th>
              <th className="text-right">수량</th>
              <th>창고</th>
              <th>사유</th>
              <th>거래처 · 현장</th>
              <th>시공자</th>
              <th>작성자</th>
              {canPrice && <th className="text-right">단가</th>}
              {canPrice && <th className="text-right">공급가</th>}
              {canPrice && <th className="text-right">부가세</th>}
              <th>상태 · 메모</th>
              {canMove && <th></th>}
            </tr>
          </thead>
          <tbody>
            {list.map((m) => {
              const a = amountOf(m);
              return (
                <tr key={m.id} className={m.voided_at ? "opacity-60" : ""}>
                  <td className="mono text-xs whitespace-nowrap">{mmdd(m.moved_on)}</td>
                  <td><KindBadge kind={m.kind} voided={Boolean(m.voided_at)} /></td>
                  <td className="font-semibold whitespace-nowrap">{m.item ? itemLabel(m.item) : "(품목 없음)"}</td>
                  <td className={`num ${m.voided_at ? "line-through" : ""}`}>
                    {m.kind === "adjust" ? (m.to_wh ? "+" : "−") : ""}{qtyText(m.qty)} <span className="text-muted text-xs font-normal">{m.item?.unit}</span>
                  </td>
                  <td className="text-xs whitespace-nowrap">{moveRoute(m)}</td>
                  <td className="text-xs whitespace-nowrap">{reasonLabel(m.reason)}</td>
                  <td className="text-xs"><MoveRef m={m} /></td>
                  <td className="text-xs">{m.technician?.name ?? <span className="zero">—</span>}</td>
                  <td className="text-xs">{m.creator?.display_name ?? <span className="zero">—</span>}</td>
                  {canPrice && <td className={`num ${Number(a?.unit_price) ? "" : "zero"}`}>{won(a?.unit_price)}</td>}
                  {canPrice && <td className={`num ${Number(a?.supply_amount) ? "" : "zero"}`}>{won(a?.supply_amount)}</td>}
                  {canPrice && <td className={`num ${Number(a?.vat_amount) ? "" : "zero"}`}>{won(a?.vat_amount)}</td>}
                  <td className="text-xs text-muted">
                    {m.note}
                    {m.voided_at && <div className="text-danger">취소됨: {m.void_reason}{m.voider?.display_name ? ` (${m.voider.display_name})` : ""}</div>}
                  </td>
                  {canMove && (
                    <td className="whitespace-nowrap">
                      <div className="grid gap-1">
                        {canVoid(m) && <VoidDetails id={m.id} />}
                        {canPrice && !m.voided_at && (
                          <details>
                            <summary className="cursor-pointer text-accent text-xs">단가 수정</summary>
                            <ActionForm action={updateMoveAmount} className="mt-2 grid gap-2 min-w-[160px]">
                              <input type="hidden" name="move_id" value={m.id} />
                              <input name="unit_price" inputMode="numeric" defaultValue={a ? String(Math.round(Number(a.unit_price))) : ""} className="field mono text-right" aria-label="단가" />
                              <SubmitButton className="btn btn-sm">저장</SubmitButton>
                            </ActionForm>
                          </details>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={cols} className="text-center text-muted py-8">기간 안에 내역이 없습니다.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={cols}>
                {list.length}건 (취소 {list.length - live.length}건 포함{list.length >= 500 ? ", 최근 500건까지" : ""}) · 수량(취소 제외): 입고 {qtyText(qtyBy("in"))} · 출고 {qtyText(qtyBy("out"))} · 이동 {qtyText(qtyBy("transfer"))} · 조정 +{qtyText(adjPlus)} / −{qtyText(adjMinus)}
                {canPrice && ` · 공급가: 입고 ${won(sumAmt("in", "supply_amount"))} (부가세 ${won(sumAmt("in", "vat_amount"))}) · 출고 ${won(sumAmt("out", "supply_amount"))} (부가세 ${won(sumAmt("out", "vat_amount"))})`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-3.5 py-2 text-xs text-muted">내역은 고칠 수 없고 취소만 됩니다. 취소하면 재고와 금액 집계에서 빠지고 기록은 남습니다.</p>
    </div>
  );
}
