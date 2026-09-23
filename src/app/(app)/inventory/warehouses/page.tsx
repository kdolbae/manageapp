import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { WAREHOUSE_KIND, qtyText } from "@/lib/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createWarehouse, setDefaultWarehouse, updateWarehouse } from "@/lib/actions/inventory";
import { branchOptions, ensureOption, type Option } from "../../people/data";
import { loadStock, loadWarehouses, technicianOptions } from "../data";
import { NoPermission, WarehouseKindBadge } from "../shared";

export const metadata = { title: "창고" };

function WarehouseFields({ idPrefix, branches, technicians, v }: { idPrefix: string; branches: Option[]; technicians: Option[]; v: { kind?: string; name?: string; branch_id?: string | null; technician_id?: string | null } }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="form-row">
          <label className="label" htmlFor={id("kind")}>종류<span className="req">*</span></label>
          <select id={id("kind")} name="kind" defaultValue={v.kind ?? "hq"} className="field">
            {Object.entries(WAREHOUSE_KIND).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="label" htmlFor={id("branch")}>지점</label>
          <select id={id("branch")} name="branch_id" defaultValue={v.branch_id ?? ""} className="field">
            <option value="">본사 공통</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("name")}>이름<span className="req">*</span></label>
        <input id={id("name")} name="name" required defaultValue={v.name ?? ""} maxLength={40} placeholder="예: 본사 창고, 김기사 차량" className="field" />
      </div>
      <div className="form-row">
        <label className="label" htmlFor={id("tech")}>시공자 <span className="font-normal">(차량 창고만 · 시공자당 하나)</span></label>
        <select id={id("tech")} name="technician_id" defaultValue={v.technician_id ?? ""} className="field">
          <option value="">없음</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}

export default async function WarehousesPage() {
  const session = await requireTenant();
  if (!session.can("inventory.price")) return <NoPermission what="창고 관리" />;
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const [warehouses, stock, branches, technicians] = await Promise.all([loadWarehouses(supabase, tid, true), loadStock(supabase, tid), branchOptions(supabase, tid), technicianOptions(supabase, tid)]);
  const itemsIn = new Map<string, Set<string>>();
  const qtyIn = new Map<string, number>();
  for (const r of stock) {
    if (Number(r.qty) === 0) continue;
    if (!itemsIn.has(r.warehouse_id)) itemsIn.set(r.warehouse_id, new Set());
    itemsIn.get(r.warehouse_id)!.add(r.item_id);
    qtyIn.set(r.warehouse_id, (qtyIn.get(r.warehouse_id) ?? 0) + Number(r.qty));
  }
  const active = warehouses.filter((w) => w.status === "active").length;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="card overflow-x-auto">
        <form id="wh-default" action={setDefaultWarehouse} className="panel-head">
          <h2>창고 <span className="sub">{active}개 운영</span></h2>
          <button className="btn btn-sm">기본 창고 저장</button>
        </form>
        <table className="tbl">
          <thead>
            <tr>
              <th>기본</th>
              <th>종류</th>
              <th>이름</th>
              <th>지점</th>
              <th>시공자</th>
              <th className="text-right">재고 품목</th>
              <th className="text-right">수량 합</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {warehouses.map((w) => (
              <tr key={w.id} className={w.status === "active" ? "" : "opacity-60"}>
                <td>
                  <input type="radio" name="default_id" value={w.id} form="wh-default" defaultChecked={w.is_default} disabled={w.status !== "active"} aria-label={`${w.name} 을 기본 창고로`} />
                </td>
                <td><WarehouseKindBadge kind={w.kind} /></td>
                <td className="font-semibold">
                  {w.name} {w.is_default && <span className="badge badge-run ml-1">기본</span>}
                </td>
                <td className="text-xs">{w.branch?.name ?? <span className="zero">—</span>}</td>
                <td className="text-xs">{w.technician?.name ?? <span className="zero">—</span>}</td>
                <td className="num">{itemsIn.get(w.id)?.size ?? <span className="zero">0</span>}</td>
                <td className={`num ${qtyIn.get(w.id) ? "" : "zero"}`}>{qtyText(qtyIn.get(w.id) ?? 0)}</td>
                <td><span className={`badge ${w.status === "active" ? "badge-done" : "badge-wait"}`}>{w.status === "active" ? "운영" : "중지"}</span></td>
                <td>
                  <details>
                    <summary className="cursor-pointer text-accent text-xs">수정</summary>
                    <ActionForm action={updateWarehouse} className="mt-2 grid gap-1 min-w-[280px]">
                      <input type="hidden" name="id" value={w.id} />
                      <WarehouseFields idPrefix={`wh-${w.id.slice(0, 8)}`} branches={withCurrent(branches, w.branch_id, w.branch?.name)} technicians={withCurrent(technicians, w.technician_id, w.technician?.name)} v={w} />
                      <div className="grid grid-cols-2 gap-2">
                        <div className="form-row">
                          <label className="label" htmlFor={`wh-${w.id.slice(0, 8)}-status`}>상태</label>
                          <select id={`wh-${w.id.slice(0, 8)}-status`} name="status" defaultValue={w.status} className="field">
                            <option value="active">운영</option>
                            <option value="inactive">중지</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-sm pt-5">
                          <input type="checkbox" name="is_default" defaultChecked={w.is_default} /> 기본 창고
                        </label>
                      </div>
                      <SubmitButton className="btn btn-sm">저장</SubmitButton>
                    </ActionForm>
                  </details>
                </td>
              </tr>
            ))}
            {warehouses.length === 0 && (
              <tr><td colSpan={9} className="text-center text-muted py-8">창고가 없습니다. 오른쪽에서 추가합니다.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9}>{warehouses.length}개 창고 · 입고 기본값과 CSV 기초재고는 &lsquo;기본&rsquo; 창고로 들어갑니다 · 차량 창고는 시공자에게 연결하면 그 시공자가 출고 화면에서 본인 재고를 봅니다</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ActionForm action={createWarehouse} className="card p-4">
        <h2 className="text-sm font-semibold mb-3">창고 추가</h2>
        <WarehouseFields idPrefix="wh-new" branches={branches} technicians={technicians} v={{ kind: "vehicle", branch_id: session.current.branch_id }} />
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" name="is_default" /> 기본 창고로 지정
        </label>
        <SubmitButton>추가</SubmitButton>
      </ActionForm>
    </div>
  );
}

/** 현재 값이 선택지에 없으면(중지된 지점·시공자) 끼워 넣어 저장할 때 값이 날아가지 않게 한다. */
function withCurrent(list: Option[], id: string | null | undefined, name?: string | null) {
  const copy = [...list];
  ensureOption(copy, id, name);
  return copy;
}
