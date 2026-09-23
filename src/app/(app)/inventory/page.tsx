import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues, labelOf } from "@/lib/codes";
import { won, shortDate } from "@/lib/format";
import { qtyText } from "@/lib/inventory";
import { groupByCategory, indexStock, loadItems, loadPrices, loadStock, loadWarehouses, myTechnician, stockKey, type ItemPrice } from "./data";
import { NoPermission } from "./shared";

export const metadata = { title: "재고 현황" };

function listHref(cat: string, q: string, low: boolean) {
  const sp = new URLSearchParams();
  if (cat) sp.set("cat", cat);
  if (q) sp.set("q", q);
  if (low) sp.set("low", "1");
  const s = sp.toString();
  return s ? `/inventory?${s}` : "/inventory";
}

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const session = await requireTenant();
  if (!session.can("inventory.read")) return <NoPermission />;
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const cat = (typeof sp.cat === "string" ? sp.cat : "").slice(0, 40);
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 50);
  const low = sp.low === "1";
  const canPrice = session.can("inventory.price");
  const own = session.current.scope === "own";
  const supabase = await createClient();

  const [items, warehouses, stock, categories, prices, myTech] = await Promise.all([
    loadItems(supabase, tid),
    loadWarehouses(supabase, tid),
    loadStock(supabase, tid),
    codeValues(tid, "inv_category"),
    canPrice ? loadPrices(supabase, tid) : Promise.resolve(new Map<string, ItemPrice>()),
    myTechnician(supabase, tid, session.user.id),
  ]);
  const { byCell, total, last } = indexStock(stock);
  const myVehicle = myTech ? (warehouses.find((w) => w.technician_id === myTech.id) ?? null) : null;
  // 시공기사(본인 범위)는 RLS 가 본인 차량 창고 분만 돌려주므로 그 칸만 보여 준다.
  const cols = own && myVehicle ? [myVehicle] : warehouses;

  const qn = q.toLowerCase();
  const matches = (i: (typeof items)[number]) => {
    if (cat && i.category_code !== cat) return false;
    if (low && !((total.get(i.id) ?? 0) < Number(i.min_stock))) return false;
    if (qn && ![i.name, i.spec, i.code, i.full_name].some((v) => v && v.toLowerCase().includes(qn))) return false;
    return true;
  };
  const groups = groupByCategory(items.filter(matches), categories);
  const rows = groups.flatMap((g) => g.items);
  const lowCount = items.filter((i) => (total.get(i.id) ?? 0) < Number(i.min_stock)).length;
  const buyOf = (id: string) => Number(prices.get(id)?.buy_price ?? 0);
  const assetOf = (id: string) => (total.get(id) ?? 0) * buyOf(id);
  const assetAll = items.reduce((s, i) => s + assetOf(i.id), 0);
  const assetListed = rows.reduce((s, i) => s + assetOf(i.id), 0);
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.category_code, (counts.get(i.category_code) ?? 0) + 1);
  const lastAny = Array.from(last.values()).sort().at(-1);
  const colCount = 3 + cols.length + 3 + (canPrice ? 2 : 0);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 border-b border-border bg-surface">
        <div className="stat"><div className="k">사용 중 품목</div><div className="v">{items.length}</div></div>
        <div className="stat"><div className="k">최소재고 미만</div><div className={`v ${lowCount ? "text-danger" : "zero"}`}>{lowCount}</div></div>
        <div className="stat"><div className="k">창고</div><div className="v">{warehouses.length}</div></div>
        {canPrice ? (
          <div className="stat"><div className="k">재고자산 (매입가 기준)</div><div className={`v ${assetAll ? "" : "zero"}`}>{won(assetAll)}</div></div>
        ) : (
          <div className="stat"><div className="k">최근 이동</div><div className={`v ${lastAny ? "" : "zero"}`}>{shortDate(lastAny) || "—"}</div></div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 bg-bg border-b border-border">
        <Link href={listHref("", q, low)} className={`chip ${!cat ? "is-active" : ""}`}>전체 <span className="mono text-muted">{items.length}</span></Link>
        {categories.filter((c) => counts.get(c.code)).map((c) => (
          <Link key={c.code} href={listHref(c.code, q, low)} className={`chip ${cat === c.code ? "is-active" : ""}`}>
            {c.label} <span className="mono text-muted">{counts.get(c.code)}</span>
          </Link>
        ))}
        <Link href={listHref(cat, q, !low)} className={`chip ${low ? "is-active" : ""}`}>부족만{lowCount ? <span className="mono text-danger">{lowCount}</span> : null}</Link>
        <form method="get" action="/inventory" className="flex gap-1 ml-auto">
          {cat && <input type="hidden" name="cat" value={cat} />}
          {low && <input type="hidden" name="low" value="1" />}
          <input name="q" defaultValue={q} placeholder="품목명·규격·코드" aria-label="품목 검색" className="field h-8 text-xs w-[170px]" />
          <button className="btn btn-sm">검색</button>
          {q && <Link href={listHref(cat, "", low)} className="btn btn-sm">지우기</Link>}
        </form>
      </div>
      {own && (
        <p className="px-3.5 py-2 text-xs text-muted border-b border-border">
          본인 범위 계정이라 {myVehicle ? `내 차량 창고(${myVehicle.name})와 ` : ""}내가 기록한 내역만 집계됩니다. 다른 창고의 재고는 관리자에게 확인하세요.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>분류</th>
              <th>품목</th>
              <th>단위</th>
              {cols.map((w) => (
                <th key={w.id} className="text-right whitespace-nowrap">
                  {w.name}
                  {w.is_default && <span className="text-muted font-normal"> 기본</span>}
                </th>
              ))}
              <th className="text-right">합계</th>
              <th className="text-right">최소재고</th>
              <th>최근 이동</th>
              {canPrice && <th className="text-right">매입단가</th>}
              {canPrice && <th className="text-right">재고자산</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const sum = total.get(i.id) ?? 0;
              const min = Number(i.min_stock);
              const short = sum < min;
              return (
                <tr key={i.id}>
                  <td className="text-xs text-muted whitespace-nowrap">{labelOf(categories, i.category_code) || "미분류"}</td>
                  <td className="font-semibold whitespace-nowrap">
                    {i.name} {i.spec && <span className="text-muted font-normal text-xs">{i.spec}</span>}
                    {i.code && <span className="mono text-xs text-muted ml-1">{i.code}</span>}
                  </td>
                  <td className="text-xs">{i.unit}</td>
                  {cols.map((w) => {
                    const v = byCell.get(stockKey(i.id, w.id)) ?? 0;
                    return (
                      <td key={w.id} className={`num ${v === 0 ? "zero" : v < 0 ? "text-danger" : ""}`}>
                        {qtyText(v)}
                      </td>
                    );
                  })}
                  <td className={`num font-semibold ${sum === 0 ? "zero" : sum < 0 ? "text-danger" : ""}`}>{qtyText(sum)}</td>
                  <td className="num whitespace-nowrap">
                    {min ? qtyText(min) : <span className="zero">—</span>}
                    {short && <span className="badge badge-risk ml-1.5">부족</span>}
                  </td>
                  <td className="mono text-xs text-muted">{shortDate(last.get(i.id)) || "—"}</td>
                  {canPrice && <td className={`num ${buyOf(i.id) ? "" : "zero"}`}>{won(buyOf(i.id))}</td>}
                  {canPrice && <td className={`num ${assetOf(i.id) ? "" : "zero"}`}>{won(assetOf(i.id))}</td>}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="text-center text-muted py-8">
                  {items.length === 0 ? (
                    <>
                      등록된 품목이 없습니다.{canPrice && <> <Link href="/inventory/items">품목·단가</Link> 에서 추가하거나 CSV 로 가져옵니다.</>}
                    </>
                  ) : (
                    "조건에 맞는 품목이 없습니다."
                  )}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={canPrice ? colCount - 1 : colCount}>
                {rows.length}개 품목{cat ? ` · ${labelOf(categories, cat)}` : ""}{low ? " · 최소재고 미만만" : ""}{q ? ` · 검색: ${q}` : ""}
                {canPrice && " · 재고자산 합계 (표시된 품목) →"}
              </td>
              {canPrice && <td className="num">{won(assetListed)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-3.5 py-2 text-xs text-muted">재고 = 창고로 들어온 수량 − 나간 수량 (취소분 제외). 음수는 재고 초과 출고가 있었다는 뜻입니다.</p>
    </div>
  );
}
