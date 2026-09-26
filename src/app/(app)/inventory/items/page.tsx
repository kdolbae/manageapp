import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues, labelOf } from "@/lib/codes";
import { won } from "@/lib/format";
import { ITEM_CSV_HEADER, qtyText } from "@/lib/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { archiveItem, createItem, importItemsCsv, updateItem } from "@/lib/actions/inventory";
import { groupByCategory, loadItems, loadPrices, type InvItem } from "../data";
import { NoPermission } from "../shared";
import { ItemFields } from "./item-fields";

export const metadata = { title: "품목·단가" };

function listHref(cat: string, q: string) {
  const sp = new URLSearchParams();
  if (cat) sp.set("cat", cat);
  if (q) sp.set("q", q);
  const s = sp.toString();
  return s ? `/inventory/items?${s}` : "/inventory/items";
}

export default async function ItemsPage({ searchParams }: PageProps<"/inventory/items">) {
  const session = await requireTenant();
  if (!session.can("inventory.read")) return <NoPermission />;
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const cat = (typeof sp.cat === "string" ? sp.cat : "").slice(0, 40);
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 50);
  const canPrice = session.can("inventory.price");
  const supabase = await createClient();

  const [items, categories, prices, { data: csvCats }] = await Promise.all([
    loadItems(supabase, tid, true),
    codeValues(tid, "inv_category"),
    canPrice ? loadPrices(supabase, tid) : Promise.resolve(new Map<string, { buy_price: number | string; sell_price: number | string; price_note: string | null }>()),
    supabase.from("code_value").select("code, label").eq("tenant_id", tid).eq("domain", "inv_category").eq("meta->>source", "csv_import"),
  ]);
  const fromCsv = (csvCats ?? []) as { code: string; label: string }[];
  const qn = q.toLowerCase();
  const matches = (i: InvItem) => (!cat || i.category_code === cat) && (!qn || [i.name, i.spec, i.code, i.full_name].some((v) => v && v.toLowerCase().includes(qn)));
  const groups = groupByCategory(items.filter(matches), categories);
  const rows = groups.flatMap((g) => [...g.items.filter((i) => i.status === "active"), ...g.items.filter((i) => i.status !== "active")]);
  const activeCount = items.filter((i) => i.status === "active").length;
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.category_code, (counts.get(i.category_code) ?? 0) + 1);
  const cols = 7 + (canPrice ? 4 : 0);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="grid gap-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={listHref("", q)} className={`chip ${!cat ? "is-active" : ""}`}>전체 <span className="mono text-muted">{items.length}</span></Link>
          {categories.filter((c) => counts.get(c.code)).map((c) => (
            <Link key={c.code} href={listHref(c.code, q)} className={`chip ${cat === c.code ? "is-active" : ""}`}>
              {c.label} <span className="mono text-muted">{counts.get(c.code)}</span>
            </Link>
          ))}
          <form method="get" action="/inventory/items" className="flex gap-1 ml-auto">
            {cat && <input type="hidden" name="cat" value={cat} />}
            <input name="q" defaultValue={q} placeholder="품목명·규격·코드" aria-label="품목 검색" className="field h-8 text-xs w-[170px]" />
            <button className="btn btn-sm">검색</button>
            {q && <Link href={listHref(cat, "")} className="btn btn-sm">지우기</Link>}
          </form>
        </div>
        {fromCsv.length > 0 && (
          <p className="notice text-xs">
            CSV 가져오기로 만들어진 분류: {fromCsv.map((c) => `${c.label} (${c.code})`).join(", ")}. 이름·순서를 바꾸려면 사업체 설정 권한자가 코드값(inv_category)을 고쳐야 합니다.
          </p>
        )}
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>분류</th>
                <th>코드</th>
                <th>품목</th>
                <th>규격</th>
                <th>단위</th>
                <th className="text-right">최소재고</th>
                <th>상태</th>
                {canPrice && <th className="text-right">매입단가</th>}
                {canPrice && <th className="text-right">판매단가</th>}
                {canPrice && <th>단가 메모</th>}
                {canPrice && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const p = prices.get(i.id);
                const active = i.status === "active";
                return (
                  <tr key={i.id} className={active ? "" : "opacity-60"}>
                    <td className="text-xs text-muted whitespace-nowrap">{labelOf(categories, i.category_code) || i.category_code}</td>
                    <td className="mono text-xs">{i.code ?? <span className="zero">—</span>}</td>
                    <td className="font-semibold whitespace-nowrap">
                      {i.name}
                      {i.full_name && <div className="text-xs text-muted font-normal">{i.full_name}</div>}
                    </td>
                    <td className="text-xs">{i.spec ?? <span className="zero">—</span>}</td>
                    <td className="text-xs">{i.unit}</td>
                    <td className="num">{Number(i.min_stock) ? qtyText(i.min_stock) : <span className="zero">0</span>}</td>
                    <td><span className={`badge ${active ? "badge-done" : "badge-wait"}`}>{active ? "사용" : "중지"}</span></td>
                    {canPrice && <td className={`num ${Number(p?.buy_price) ? "" : "zero"}`}>{won(p?.buy_price)}</td>}
                    {canPrice && <td className={`num ${Number(p?.sell_price) ? "" : "zero"}`}>{won(p?.sell_price)}</td>}
                    {canPrice && <td className="text-xs text-muted max-w-[220px]">{p?.price_note}</td>}
                    {canPrice && (
                      <td>
                        <details>
                          <summary className="cursor-pointer text-accent text-xs">수정</summary>
                          <ActionForm action={updateItem} className="mt-2 grid gap-2 min-w-[260px]">
                            <input type="hidden" name="id" value={i.id} />
                            <ItemFields idPrefix={`it-${i.id.slice(0, 8)}`} categories={categories} v={{ ...i, buy_price: p?.buy_price ?? 0, sell_price: p?.sell_price ?? 0, price_note: p?.price_note ?? null }} withStatus />
                            <SubmitButton className="btn btn-sm">저장</SubmitButton>
                          </ActionForm>
                          <ActionForm action={archiveItem} className="mt-2">
                            <input type="hidden" name="id" value={i.id} />
                            <SubmitButton className="btn btn-sm btn-danger">보관 (목록에서 숨김)</SubmitButton>
                          </ActionForm>
                        </details>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols} className="text-center text-muted py-8">
                    {items.length === 0 ? "등록된 품목이 없습니다." + (canPrice ? " 오른쪽에서 추가하거나 CSV 로 가져옵니다." : "") : "조건에 맞는 품목이 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={cols}>
                  {items.length}개 품목 · 사용 {activeCount}개{items.length > activeCount ? ` · 중지 ${items.length - activeCount}개` : ""}{!canPrice ? " · 단가는 단가 조회 권한이 있어야 보입니다" : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {canPrice && (
        <div className="grid gap-4">
          <ActionForm action={createItem} className="card p-4">
            <h2 className="text-sm font-semibold mb-3">품목 추가</h2>
            {categories.length === 0 && <p className="notice notice-danger mb-3">품목 분류(inv_category)가 없습니다. 사업체 설정에서 코드값을 먼저 만들어 주세요.</p>}
            <ItemFields idPrefix="it-new" categories={categories} v={{ unit: "EA", min_stock: 0, buy_price: 0, sell_price: 0 }} />
            <SubmitButton>추가</SubmitButton>
          </ActionForm>

          <details className="card">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">CSV 가져오기</summary>
            <ActionForm action={importItemsCsv} className="px-4 pb-4">
              <p className="text-xs text-muted mb-2">
                첫 줄은 헤더(아래 그대로), 분류·품목명은 필수. 분류는 이름으로 맞추고 없으면 새로 만듭니다. 같은 분류·품목명·규격이 있으면 갱신(정식명칭·단위·최소재고·사용, 단가는 칸이 채워진 경우만), 없으면 새로 만듭니다.
                기초재고가 0 보다 크면 기본 창고로 &lsquo;기초재고&rsquo; 입고를 한 번만 만듭니다(이미 있으면 건너뜀). 사용 칸은 Y/N.
              </p>
              <textarea name="csv" required rows={8} defaultValue={ITEM_CSV_HEADER + "\n"} className="field mono text-xs" aria-label="CSV 내용" spellCheck={false} />
              <p className="text-xs text-muted mt-1 mb-2">예: 코팅제,글라스,500ml,NP Glass &amp; Ceramic,EA,63000,130000,20,3,단가표 기준,Y</p>
              <SubmitButton className="btn">가져오기</SubmitButton>
            </ActionForm>
          </details>
        </div>
      )}
    </div>
  );
}
