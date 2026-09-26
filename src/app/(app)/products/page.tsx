import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { won } from "@/lib/format";
import { KindBadge, StatusBadge, WorkAreaMark } from "./_components/product-ui";

export const metadata = { title: "상품·단가" };

type ProductRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  work_area_code: string | null;
  unit: string;
  price: string | number;
  technician_rate: string | number;
  status: string;
  category_id: string | null;
};
type CategoryRow = { id: string; code: string; name: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listHref(category: string, q: string) {
  const sp = new URLSearchParams();
  if (category) sp.set("category", category);
  if (q) sp.set("q", q);
  const s = sp.toString();
  return s ? `/products?${s}` : "/products";
}

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const rawCategory = typeof sp.category === "string" ? sp.category : "";
  const category = rawCategory === "none" || UUID.test(rawCategory) ? rawCategory : "";
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 50);
  const supabase = await createClient();

  let query = supabase
    .from("product")
    .select("id, code, name, kind, work_area_code, unit, price, technician_rate, status, category_id")
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .order("sort_order")
    .order("code");
  if (category === "none") query = query.is("category_id", null);
  else if (category) query = query.eq("category_id", category);
  const safeQ = q.replace(/[,()%\\"]/g, " ").trim();
  if (safeQ) query = query.or(`code.ilike.%${safeQ}%,name.ilike.%${safeQ}%`);

  const [{ data: products }, { data: categories }, { data: all }, { data: groups }, { data: options }, workAreas] =
    await Promise.all([
      query,
      supabase
        .from("product_category")
        .select("id, code, name")
        .eq("tenant_id", tid)
        .is("deleted_at", null)
        .order("sort_order")
        .order("name"),
      supabase.from("product").select("category_id").eq("tenant_id", tid).is("deleted_at", null),
      supabase.from("option_group").select("id, product_id").eq("tenant_id", tid),
      supabase.from("product_option").select("group_id").eq("tenant_id", tid),
      codeValues(tid, "work_area"),
    ]);

  const rows = (products ?? []) as ProductRow[];
  const cats = (categories ?? []) as CategoryRow[];

  // 카테고리별 상품 수 (필터와 무관하게 전체 기준)
  const counts = new Map<string, number>();
  let uncategorized = 0;
  for (const p of (all ?? []) as { category_id: string | null }[]) {
    if (p.category_id) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
    else uncategorized += 1;
  }
  const total = (all ?? []).length;

  // 상품별 옵션 수: 옵션 → 그룹 → 상품
  const groupProduct = new Map<string, string>();
  for (const g of (groups ?? []) as { id: string; product_id: string }[]) groupProduct.set(g.id, g.product_id);
  const optionCount = new Map<string, number>();
  for (const o of (options ?? []) as { group_id: string }[]) {
    const pid = groupProduct.get(o.group_id);
    if (pid) optionCount.set(pid, (optionCount.get(pid) ?? 0) + 1);
  }

  const showRate = session.can("payout.read") || session.can("product.manage");
  const cols = showRate ? 8 : 7;
  const filters = [
    { key: "", label: "전체", count: total },
    ...cats.map((c) => ({ key: c.id, label: c.name, count: counts.get(c.id) ?? 0 })),
    ...(uncategorized > 0 ? [{ key: "none", label: "미분류", count: uncategorized }] : []),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] items-start">
      <nav
        aria-label="카테고리"
        className="flex flex-wrap gap-1 lg:flex-col lg:gap-0.5 lg:bg-surface lg:border lg:border-border lg:rounded-[3px] lg:p-1.5"
      >
        {filters.map((f) => {
          const active = f.key === category;
          return (
            <Link
              key={f.key || "all"}
              href={listHref(f.key, q)}
              className={
                "flex items-center justify-between gap-3 px-3 py-1.5 rounded-[3px] border text-[13px] no-underline " +
                (active
                  ? "bg-accent-bg text-accent border-accent font-semibold"
                  : "text-text bg-surface border-border lg:bg-transparent lg:border-transparent hover:bg-zebra")
              }
            >
              <span className="truncate">{f.label}</span>
              <span className="mono text-xs text-muted">{f.count}</span>
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-3 min-w-0">
        <form method="get" action="/products" className="flex flex-wrap gap-2">
          {category && <input type="hidden" name="category" value={category} />}
          <input name="q" defaultValue={q} placeholder="코드·상품명 검색" aria-label="상품 검색" className="field max-w-[320px]" />
          <button type="submit" className="btn">
            검색
          </button>
          {q && (
            <Link href={listHref(category, "")} className="btn">
              지우기
            </Link>
          )}
        </form>

        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>코드</th>
                <th>상품명</th>
                <th>작업 단위</th>
                <th>단위</th>
                <th className="text-right">판매가</th>
                {showRate && <th className="text-right">기사비</th>}
                <th className="text-right">옵션 수</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono">
                    <Link href={`/products/${p.id}`}>{p.code}</Link>
                  </td>
                  <td>
                    <Link href={`/products/${p.id}`} className="font-semibold text-text no-underline hover:text-accent">
                      {p.name}
                    </Link>{" "}
                    <KindBadge kind={p.kind} />
                  </td>
                  <td>
                    <WorkAreaMark code={p.work_area_code} codes={workAreas} />
                  </td>
                  <td>{p.unit}</td>
                  <td className="num">{won(p.price)}</td>
                  {showRate && <td className="num">{won(p.technician_rate)}</td>}
                  <td className="num">{optionCount.get(p.id) ?? 0}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols} className="text-center text-muted py-8">
                    {q || category ? "조건에 맞는 상품이 없습니다." : "등록된 상품이 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={cols}>
                  {rows.length}개 상품{q ? ` · 검색: ${q}` : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
