import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { todayKST } from "@/lib/dates";
import { IN_REASONS, MOVE_REASON } from "@/lib/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createMove } from "@/lib/actions/inventory";
import { partnerOptions } from "../../people/data";
import { groupByCategory, loadItems, loadWarehouses, MOVE_SELECT, type MoveRow } from "../data";
import { ItemOptions, NoPermission, RecentMoves, WarehouseOptions } from "../shared";

export const metadata = { title: "입고·이동·조정" };

export default async function InPage() {
  const session = await requireTenant();
  if (!session.can("inventory.move")) return <NoPermission what="입고 등록" />;
  if (session.current.scope === "own") {
    return <p className="p-4 text-sm text-muted">본인 범위 계정은 입고·이동·조정을 기록할 수 없습니다. 본사에서 차량 창고로 이동해 주면 <Link href="/inventory/out">출고</Link>에서 낼 수 있습니다.</p>;
  }
  const tid = session.current.tenant_id;
  const canPrice = session.can("inventory.price");
  const today = todayKST();
  const supabase = await createClient();

  const [items, warehouses, categories, partners, { data: recentRows }] = await Promise.all([
    loadItems(supabase, tid),
    loadWarehouses(supabase, tid),
    codeValues(tid, "inv_category"),
    partnerOptions(supabase, tid),
    supabase.from("inv_move").select(MOVE_SELECT).eq("tenant_id", tid).in("kind", ["in", "transfer", "adjust"]).order("created_at", { ascending: false }).limit(30),
  ]);
  const recent = (recentRows ?? []) as unknown as MoveRow[];
  const groups = groupByCategory(items, categories);
  const defaultWh = warehouses.find((w) => w.is_default) ?? warehouses[0] ?? null;
  const canVoid = (m: MoveRow) => canPrice || m.created_by === session.user.id;
  const ready = items.length > 0 && warehouses.length > 0;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="order-last lg:order-first">
        <h2 className="text-sm font-semibold mb-2">최근 입고·이동·조정 <span className="text-muted font-normal text-xs">최근 30건 · 전체는 내역 탭</span></h2>
        <RecentMoves rows={recent} canVoid={canVoid} />
      </div>

      <div className="grid gap-4">
        {!ready && (
          <p className="notice">
            {items.length === 0 && <><Link href="/inventory/items">품목</Link>이 없습니다. </>}
            {warehouses.length === 0 && <><Link href="/inventory/warehouses">창고</Link>가 없습니다. </>}
            먼저 만들어야 등록할 수 있습니다.
          </p>
        )}

        <ActionForm action={createMove} className="card p-4">
          <input type="hidden" name="kind" value="in" />
          <h2 className="text-sm font-semibold mb-3">입고</h2>
          <div className="form-row">
            <label className="label" htmlFor="in-item">품목<span className="req">*</span></label>
            <select id="in-item" name="item_id" required defaultValue="" className="field">
              <option value="" disabled>품목을 고르세요</option>
              <ItemOptions groups={groups} />
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="form-row">
              <label className="label" htmlFor="in-qty">수량<span className="req">*</span></label>
              <input id="in-qty" name="qty" required inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" className="field mono text-right" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="in-date">일자</label>
              <input id="in-date" type="date" name="moved_on" defaultValue={today} className="field mono" />
            </div>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="in-wh">입고 창고<span className="req">*</span></label>
            <select id="in-wh" name="to_warehouse_id" required defaultValue={defaultWh?.id ?? ""} className="field">
              <WarehouseOptions list={warehouses} />
            </select>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="in-reason">사유</label>
            <select id="in-reason" name="reason" defaultValue="purchase" className="field">
              {IN_REASONS.map((r) => (
                <option key={r} value={r}>{MOVE_REASON[r].label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="in-partner">거래처</label>
            <select id="in-partner" name="partner_id" defaultValue="" className="field">
              <option value="">협력업체에 없음 (아래에 이름)</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input name="partner_name" maxLength={80} placeholder="거래처 이름 (협력업체 미등록 시)" className="field mt-1" aria-label="거래처 이름" />
          </div>
          <div className={`grid gap-2 ${canPrice ? "grid-cols-2" : ""}`}>
            <div className="form-row">
              <label className="label" htmlFor="in-doc">거래명세서 번호</label>
              <input id="in-doc" name="doc_no" maxLength={40} className="field mono" />
            </div>
            {canPrice && (
              <div className="form-row">
                <label className="label" htmlFor="in-price">매입단가 <span className="font-normal">(비우면 품목 단가)</span></label>
                <input id="in-price" name="unit_price" inputMode="numeric" className="field mono text-right" placeholder="원" />
              </div>
            )}
          </div>
          <div className="form-row">
            <label className="label" htmlFor="in-note">메모</label>
            <input id="in-note" name="note" maxLength={500} className="field" />
          </div>
          <SubmitButton className="btn btn-primary w-full">입고 등록</SubmitButton>
        </ActionForm>

        <div className="card p-4 grid gap-5">
          <ActionForm action={createMove}>
            <input type="hidden" name="kind" value="transfer" />
            <h2 className="text-sm font-semibold mb-1">창고 이동</h2>
            <p className="text-xs text-muted mb-3">본사 → 차량처럼 창고 사이로 옮깁니다. 보내는 창고 재고에서 빠지고 받는 창고에 더해집니다.</p>
            <div className="form-row">
              <label className="label" htmlFor="tr-item">품목<span className="req">*</span></label>
              <select id="tr-item" name="item_id" required defaultValue="" className="field">
                <option value="" disabled>품목을 고르세요</option>
                <ItemOptions groups={groups} />
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="form-row">
                <label className="label" htmlFor="tr-qty">수량<span className="req">*</span></label>
                <input id="tr-qty" name="qty" required inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" className="field mono text-right" />
              </div>
              <div className="form-row">
                <label className="label" htmlFor="tr-date">일자</label>
                <input id="tr-date" type="date" name="moved_on" defaultValue={today} className="field mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="form-row">
                <label className="label" htmlFor="tr-from">보내는 창고<span className="req">*</span></label>
                <select id="tr-from" name="from_warehouse_id" required defaultValue={defaultWh?.id ?? ""} className="field">
                  <WarehouseOptions list={warehouses} />
                </select>
              </div>
              <div className="form-row">
                <label className="label" htmlFor="tr-to">받는 창고<span className="req">*</span></label>
                <select id="tr-to" name="to_warehouse_id" required defaultValue="" className="field">
                  <WarehouseOptions list={warehouses} empty="고르세요" />
                </select>
              </div>
            </div>
            <div className="form-row">
              <label className="label" htmlFor="tr-note">메모</label>
              <input id="tr-note" name="note" maxLength={500} className="field" />
            </div>
            <SubmitButton className="btn w-full">이동 등록</SubmitButton>
          </ActionForm>

          <ActionForm action={createMove} className="border-t border-border pt-4">
            <input type="hidden" name="kind" value="adjust" />
            <h2 className="text-sm font-semibold mb-1">재고 조정 (실사)</h2>
            <p className="text-xs text-muted mb-3">실제 수량과 장부가 다를 때 차이만큼 더하거나(+) 뺍니다(−). 사유를 꼭 적어 주세요.</p>
            <div className="form-row">
              <label className="label" htmlFor="adj-item">품목<span className="req">*</span></label>
              <select id="adj-item" name="item_id" required defaultValue="" className="field">
                <option value="" disabled>품목을 고르세요</option>
                <ItemOptions groups={groups} />
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="form-row">
                <label className="label" htmlFor="adj-dir">방향<span className="req">*</span></label>
                <select id="adj-dir" name="direction" defaultValue="minus" className="field">
                  <option value="plus">+ 더하기 (재고 보정 +)</option>
                  <option value="minus">− 빼기 (재고 보정 −)</option>
                </select>
              </div>
              <div className="form-row">
                <label className="label" htmlFor="adj-qty">차이 수량<span className="req">*</span></label>
                <input id="adj-qty" name="qty" required inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" className="field mono text-right" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="form-row">
                <label className="label" htmlFor="adj-wh">창고<span className="req">*</span></label>
                <select id="adj-wh" name="warehouse_id" required defaultValue={defaultWh?.id ?? ""} className="field">
                  <WarehouseOptions list={warehouses} />
                </select>
              </div>
              <div className="form-row">
                <label className="label" htmlFor="adj-date">일자</label>
                <input id="adj-date" type="date" name="moved_on" defaultValue={today} className="field mono" />
              </div>
            </div>
            <div className="form-row">
              <label className="label" htmlFor="adj-note">사유<span className="req">*</span></label>
              <input id="adj-note" name="note" required maxLength={500} placeholder="예: 9월 실사, 파손 2개" className="field" />
            </div>
            <SubmitButton className="btn w-full">조정 등록</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
