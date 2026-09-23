import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { won } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  updateProduct,
  archiveProduct,
  createOptionGroup,
  deleteOptionGroup,
  createOption,
  updateOption,
  deleteOption,
  addPackageItem,
  removePackageItem,
  createPriceRule,
  deletePriceRule,
  createTechnicianRate,
  deleteTechnicianRate,
} from "@/lib/actions/products";
import {
  KindBadge,
  ProductFields,
  StatusBadge,
  WorkAreaMark,
  signed,
  type CategoryOption,
  type ProductValues,
} from "../_components/product-ui";

export const metadata = { title: "상품" };

type Product = ProductValues & {
  id: string;
  status: string;
  category: { id: string; name: string } | null;
};
type Option = {
  id: string;
  name: string;
  price_delta: string | number;
  technician_rate_delta: string | number;
  is_default: boolean;
  sort_order: number;
  created_at: string;
};
type OptionGroup = {
  id: string;
  name: string;
  required: boolean;
  multi: boolean;
  sort_order: number;
  product_option: Option[] | null;
};
type PackageItem = {
  id: string;
  qty: string | number;
  price_override: string | number | null;
  sort_order: number;
  product: { id: string; code: string; name: string; unit: string; price: string | number; deleted_at: string | null } | null;
};
type PriceRule = {
  id: string;
  branch_id: string | null;
  partner_id: string | null;
  complex_id: string | null;
  price: string | number | null;
  technician_rate: string | number | null;
  valid_from: string | null;
  valid_to: string | null;
  priority: number;
  memo: string | null;
  branch: { name: string } | null;
  partner: { name: string } | null;
  complex: { name: string } | null;
};
type TechRate = {
  id: string;
  technician_id: string;
  rate: string | number;
  valid_from: string | null;
  valid_to: string | null;
  technician: { name: string } | null;
};
type Named = { id: string; name: string };
type Component = { id: string; code: string; name: string; price: string | number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function period(from: string | null, to: string | null) {
  if (!from && !to) return "상시";
  return `${from ?? ""} ~ ${to ?? ""}`;
}

function ruleTarget(r: PriceRule) {
  const parts: string[] = [];
  if (r.branch_id) parts.push(`지점 ${r.branch?.name ?? "(조회 불가)"}`);
  if (r.partner_id) parts.push(`협력업체 ${r.partner?.name ?? "(조회 불가)"}`);
  if (r.complex_id) parts.push(`단지 ${r.complex?.name ?? "(조회 불가)"}`);
  return parts.length ? parts.join(" · ") : "전체";
}

/** 표 안의 글자 버튼(삭제·빼기). */
const TEXT_DANGER = "text-xs text-danger cursor-pointer hover:underline";

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const canManage = session.can("product.manage");
  const canRates = canManage || session.can("payout.read");
  const canRules = canManage || session.can("contract.read");
  const supabase = await createClient();

  const { data: found } = await supabase
    .from("product")
    .select(
      "id, code, name, kind, category_id, work_area_code, unit, price, technician_rate, duration_min, description, status, app_service_id, category:product_category(id, name)",
    )
    .eq("id", id)
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!found) notFound();
  const product = found as unknown as Product;
  const isPackage = product.kind === "package";

  const [{ data: groupRows }, { data: itemRows }, { data: ruleRows }, { data: rateRows }, { data: categoryRows }, workAreas] =
    await Promise.all([
      supabase
        .from("option_group")
        .select(
          "id, name, required, multi, sort_order, product_option(id, name, price_delta, technician_rate_delta, is_default, sort_order, created_at)",
        )
        .eq("product_id", id)
        .eq("tenant_id", tid)
        .order("sort_order")
        .order("created_at"),
      isPackage
        ? supabase
            .from("package_item")
            .select("id, qty, price_override, sort_order, product:product!product_id(id, code, name, unit, price, deleted_at)")
            .eq("package_id", id)
            .eq("tenant_id", tid)
            .order("sort_order")
        : Promise.resolve({ data: null }),
      canRules
        ? supabase
            .from("price_rule")
            .select(
              "id, branch_id, partner_id, complex_id, price, technician_rate, valid_from, valid_to, priority, memo, branch:branch(name), partner:partner(name), complex:complex(name)",
            )
            .eq("product_id", id)
            .eq("tenant_id", tid)
            .order("priority", { ascending: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: null }),
      canRates
        ? supabase
            .from("technician_rate")
            .select("id, technician_id, rate, valid_from, valid_to, technician:technician(name)")
            .eq("product_id", id)
            .eq("tenant_id", tid)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: null }),
      supabase.from("product_category").select("id, name, deleted_at").eq("tenant_id", tid).order("sort_order").order("name"),
      codeValues(tid, "work_area"),
    ]);

  // 선택 목록은 수정 권한이 있을 때만 필요하다.
  let branches: Named[] = [];
  let partners: Named[] = [];
  let complexes: Named[] = [];
  let technicians: Named[] = [];
  let components: Component[] = [];
  if (canManage) {
    const [b, pa, cx, t, cp] = await Promise.all([
      supabase
        .from("branch")
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("is_hq", { ascending: false })
        .order("name"),
      supabase.from("partner").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("name"),
      supabase.from("complex").select("id, name").eq("tenant_id", tid).is("deleted_at", null).order("name"),
      supabase
        .from("technician")
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("sort_order")
        .order("name"),
      isPackage
        ? supabase
            .from("product")
            .select("id, code, name, price")
            .eq("tenant_id", tid)
            .in("kind", ["single", "service"])
            .eq("status", "active")
            .is("deleted_at", null)
            .order("code")
        : Promise.resolve({ data: null }),
    ]);
    branches = (b.data ?? []) as Named[];
    partners = (pa.data ?? []) as Named[];
    complexes = (cx.data ?? []) as Named[];
    technicians = (t.data ?? []) as Named[];
    components = (cp.data ?? []) as Component[];
  }

  const allCategories = (categoryRows ?? []) as CategoryOption[];
  const categories = allCategories.filter((c) => !c.deleted_at || c.id === product.category_id);
  const groups = ((groupRows ?? []) as unknown as OptionGroup[]).map((g) => ({
    ...g,
    product_option: [...(g.product_option ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
    ),
  }));
  const optionTotal = groups.reduce((n, g) => n + g.product_option.length, 0);
  const items = (itemRows ?? []) as unknown as PackageItem[];
  const itemUnit = (it: PackageItem) => Number(it.price_override ?? it.product?.price ?? 0);
  const itemsSum = items.reduce((s, it) => s + itemUnit(it) * Number(it.qty), 0);
  const rules = (ruleRows ?? []) as unknown as PriceRule[];
  const rates = (rateRows ?? []) as unknown as TechRate[];
  const optionCols = 3 + (canRates ? 1 : 0) + (canManage ? 1 : 0);
  const ruleCols = 5 + (canRates ? 1 : 0) + (canManage ? 1 : 0);

  return (
    <div className="grid gap-4 max-w-[1100px]">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/products" className="text-muted no-underline hover:underline">
          상품
        </Link>
        <span className="text-muted">/</span>
        <span className="mono">{product.code}</span>
        <span className="font-semibold">{product.name}</span>
        <KindBadge kind={product.kind} />
        <StatusBadge status={product.status} />
        <WorkAreaMark code={product.work_area_code} codes={workAreas} />
      </div>

      {/* 1. 기본 정보 */}
      <div className="card">
        <div className="panel-head">
          <h2>
            기본 정보 <span className="sub">{product.category?.name ?? "미분류"}</span>
          </h2>
        </div>
        {canManage ? (
          <ActionForm action={updateProduct} className="p-4">
            <input type="hidden" name="id" value={product.id} />
            <ProductFields product={product} categories={categories} workAreas={workAreas} withStatus />
            <SubmitButton>저장</SubmitButton>
          </ActionForm>
        ) : (
          <fieldset disabled className="p-4 m-0 border-0 min-w-0">
            <ProductFields product={product} categories={categories} workAreas={workAreas} withStatus showRate={canRates} />
          </fieldset>
        )}
        {canManage && (
          <details className="border-t border-border px-4 py-3">
            <summary className="cursor-pointer text-xs text-danger">이 상품 보관하기</summary>
            <ActionForm action={archiveProduct} className="mt-2 flex flex-wrap items-center gap-3">
              <input type="hidden" name="id" value={product.id} />
              <span className="text-xs text-muted">보관하면 목록과 계약 등록에서 사라집니다. 기존 계약 기록에는 남습니다.</span>
              <SubmitButton className="btn btn-sm btn-danger">보관</SubmitButton>
            </ActionForm>
          </details>
        )}
      </div>

      {/* 2. 옵션 */}
      <div className="card">
        <div className="panel-head">
          <h2>
            옵션{" "}
            <span className="sub">
              {groups.length}그룹 · {optionTotal}개
            </span>
          </h2>
        </div>
        {groups.length === 0 && (
          <p className="px-4 py-5 text-sm text-muted">
            옵션 그룹이 없습니다.{canManage && " 아래에서 그룹을 먼저 만든 뒤 옵션을 추가합니다."}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.id} className="border-b border-border">
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-bg">
              <span className="font-semibold text-sm">{g.name}</span>
              {g.required && <span className="badge badge-risk">필수</span>}
              {g.multi && <span className="badge badge-wait">복수 선택</span>}
              <span className="mono text-xs text-muted">{g.product_option.length}개</span>
              {canManage && (
                <details className="ml-auto">
                  <summary className="cursor-pointer text-xs text-danger">그룹 삭제</summary>
                  <form action={deleteOptionGroup} className="mt-1 flex items-center gap-2">
                    <input type="hidden" name="id" value={g.id} />
                    <input type="hidden" name="product_id" value={product.id} />
                    <span className="text-xs text-muted">옵션 {g.product_option.length}개도 함께 지워집니다.</span>
                    <button className="btn btn-sm btn-danger">삭제</button>
                  </form>
                </details>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>옵션명</th>
                    <th className="text-right">가격 가감</th>
                    {canRates && <th className="text-right">기사비 가감</th>}
                    <th>기본값</th>
                    {canManage && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {g.product_option.map((o) => (
                    <tr key={o.id}>
                      <td className="font-semibold">{o.name}</td>
                      <td className="num">{signed(o.price_delta)}</td>
                      {canRates && <td className="num">{signed(o.technician_rate_delta)}</td>}
                      <td>{o.is_default ? <span className="badge badge-done">기본</span> : <span className="zero">—</span>}</td>
                      {canManage && (
                        <td>
                          <div className="flex items-start gap-3">
                            <details>
                              <summary className="cursor-pointer text-accent text-xs">수정</summary>
                              <ActionForm action={updateOption} className="mt-2 grid gap-2 min-w-[220px]">
                                <input type="hidden" name="id" value={o.id} />
                                <input type="hidden" name="product_id" value={product.id} />
                                <input name="name" defaultValue={o.name} required maxLength={60} placeholder="옵션명" className="field" />
                                <input
                                  name="price_delta"
                                  defaultValue={won(o.price_delta)}
                                  inputMode="numeric"
                                  placeholder="가격 가감"
                                  className="field num"
                                />
                                <input
                                  name="technician_rate_delta"
                                  defaultValue={won(o.technician_rate_delta)}
                                  inputMode="numeric"
                                  placeholder="기사비 가감"
                                  className="field num"
                                />
                                <label className="flex items-center gap-1.5 text-xs">
                                  <input type="checkbox" name="is_default" defaultChecked={o.is_default} /> 기본값
                                </label>
                                <SubmitButton className="btn btn-sm">저장</SubmitButton>
                              </ActionForm>
                            </details>
                            <form action={deleteOption}>
                              <input type="hidden" name="id" value={o.id} />
                              <input type="hidden" name="product_id" value={product.id} />
                              <button className={TEXT_DANGER}>삭제</button>
                            </form>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {g.product_option.length === 0 && (
                    <tr>
                      <td colSpan={optionCols} className="text-muted text-center py-4">
                        옵션이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canManage && (
              <ActionForm action={createOption} className="px-4 py-3">
                <div className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="group_id" value={g.id} />
                  <div className="grow min-w-[160px]">
                    <label className="label" htmlFor={`on-${g.id}`}>
                      옵션 추가
                    </label>
                    <input id={`on-${g.id}`} name="name" required maxLength={60} placeholder="옵션명" className="field" />
                  </div>
                  <div className="w-[130px]">
                    <label className="label" htmlFor={`op-${g.id}`}>
                      가격 가감
                    </label>
                    <input id={`op-${g.id}`} name="price_delta" inputMode="numeric" placeholder="0" className="field num" />
                  </div>
                  <div className="w-[130px]">
                    <label className="label" htmlFor={`ot-${g.id}`}>
                      기사비 가감
                    </label>
                    <input id={`ot-${g.id}`} name="technician_rate_delta" inputMode="numeric" placeholder="0" className="field num" />
                  </div>
                  <label className="flex items-center gap-1.5 h-10 text-sm">
                    <input type="checkbox" name="is_default" /> 기본값
                  </label>
                  <SubmitButton className="btn">추가</SubmitButton>
                </div>
              </ActionForm>
            )}
          </div>
        ))}
        {canManage && (
          <ActionForm action={createOptionGroup} className="px-4 py-3 bg-bg">
            <div className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="product_id" value={product.id} />
              <div className="grow min-w-[180px]">
                <label className="label" htmlFor="og-name">
                  옵션 그룹 추가
                </label>
                <input id="og-name" name="name" required maxLength={40} placeholder="예: 시공 범위, 추가 코팅" className="field" />
              </div>
              <label className="flex items-center gap-1.5 h-10 text-sm">
                <input type="checkbox" name="required" /> 필수 선택
              </label>
              <label className="flex items-center gap-1.5 h-10 text-sm">
                <input type="checkbox" name="multi" /> 복수 선택
              </label>
              <SubmitButton className="btn">그룹 추가</SubmitButton>
            </div>
          </ActionForm>
        )}
      </div>

      {/* 3. 패키지 구성 */}
      {isPackage && (
        <div className="card">
          <div className="panel-head">
            <h2>
              패키지 구성 <span className="sub">{items.length}개 상품</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>코드</th>
                  <th>상품</th>
                  <th className="text-right">수량</th>
                  <th className="text-right">단가</th>
                  <th className="text-right">합계</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const unit = itemUnit(it);
                  const n = Number(it.qty);
                  return (
                    <tr key={it.id}>
                      <td className="mono">{it.product ? <Link href={`/products/${it.product.id}`}>{it.product.code}</Link> : "—"}</td>
                      <td className="font-semibold">
                        {it.product?.name ?? "(상품 없음)"}
                        {it.product?.deleted_at && <span className="badge badge-wait ml-1">보관됨</span>}
                      </td>
                      <td className="num">
                        {n} {it.product?.unit ?? ""}
                      </td>
                      <td className="num">
                        {won(unit)}
                        {it.price_override !== null && <span className="text-muted text-[10.5px] ml-1">지정</span>}
                      </td>
                      <td className="num">{won(unit * n)}</td>
                      {canManage && (
                        <td>
                          <form action={removePackageItem}>
                            <input type="hidden" name="id" value={it.id} />
                            <input type="hidden" name="package_id" value={product.id} />
                            <button className={TEXT_DANGER}>빼기</button>
                          </form>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 6 : 5} className="text-muted text-center py-4">
                      구성 상품이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={canManage ? 6 : 5}>
                    구성 합계 {won(itemsSum)} · 패키지 판매가 {won(product.price)} · 차액 {signed(Number(product.price) - itemsSum)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {canManage && (
            <ActionForm action={addPackageItem} className="px-4 py-3 border-t border-border">
              <div className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="package_id" value={product.id} />
                <div className="grow min-w-[220px]">
                  <label className="label" htmlFor="pi-product">
                    구성 상품 추가
                  </label>
                  <select id="pi-product" name="product_id" required defaultValue="" className="field">
                    <option value="" disabled>
                      상품 선택
                    </option>
                    {components.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name} · {won(c.price)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-[100px]">
                  <label className="label" htmlFor="pi-qty">
                    수량
                  </label>
                  <input id="pi-qty" name="qty" defaultValue="1" inputMode="decimal" className="field num" />
                </div>
                <div className="w-[150px]">
                  <label className="label" htmlFor="pi-price">
                    단가 지정 (선택)
                  </label>
                  <input id="pi-price" name="price_override" inputMode="numeric" placeholder="상품 기본가" className="field num" />
                </div>
                <SubmitButton className="btn">추가</SubmitButton>
              </div>
            </ActionForm>
          )}
        </div>
      )}

      {/* 4. 가격 규칙 */}
      {canRules && (
        <div className="card">
          <div className="panel-head">
            <h2>
              가격 규칙 <span className="sub">{rules.length}건</span>
            </h2>
          </div>
          <p className="px-4 pt-3 text-xs text-muted">
            지점·협력업체·단지·기간에 따라 판매가와 기사비를 덮어씁니다. 우선순위가 큰 규칙이 먼저, 같으면 조건이 많은 규칙이 이깁니다. 비운
            금액은 상품 기본값을 그대로 씁니다.
          </p>
          <div className="overflow-x-auto mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>적용 대상</th>
                  <th>기간</th>
                  <th className="text-right">판매가</th>
                  {canRates && <th className="text-right">기사비</th>}
                  <th className="text-right">우선순위</th>
                  <th>메모</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{ruleTarget(r)}</td>
                    <td className="mono">{period(r.valid_from, r.valid_to)}</td>
                    <td className="num">{r.price === null ? <span className="zero">기본</span> : won(r.price)}</td>
                    {canRates && (
                      <td className="num">{r.technician_rate === null ? <span className="zero">기본</span> : won(r.technician_rate)}</td>
                    )}
                    <td className="num">{r.priority}</td>
                    <td className="text-muted">{r.memo ?? ""}</td>
                    {canManage && (
                      <td>
                        <form action={deletePriceRule}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="product_id" value={product.id} />
                          <button className={TEXT_DANGER}>삭제</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr>
                    <td colSpan={ruleCols} className="text-muted text-center py-4">
                      가격 규칙이 없습니다. 상품 기본가가 적용됩니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {canManage && (
            <ActionForm action={createPriceRule} className="px-4 py-3 border-t border-border">
              <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="product_id" value={product.id} />
                <div className="form-row">
                  <label className="label" htmlFor="pr-branch">
                    지점
                  </label>
                  <select id="pr-branch" name="branch_id" defaultValue="" className="field">
                    <option value="">전체</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="pr-partner">
                    협력업체
                  </label>
                  <select id="pr-partner" name="partner_id" defaultValue="" className="field">
                    <option value="">전체</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="pr-complex">
                    단지
                  </label>
                  <select id="pr-complex" name="complex_id" defaultValue="" className="field">
                    <option value="">전체</option>
                    {complexes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="pr-priority">
                    우선순위
                  </label>
                  <input id="pr-priority" name="priority" type="number" step={1} defaultValue={0} className="field num" />
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="pr-from">
                    시작일
                  </label>
                  <input id="pr-from" name="valid_from" type="date" className="field mono" />
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="pr-to">
                    종료일
                  </label>
                  <input id="pr-to" name="valid_to" type="date" className="field mono" />
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="pr-price">
                    판매가
                  </label>
                  <input id="pr-price" name="price" inputMode="numeric" placeholder="기본값 유지" className="field num" />
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="pr-rate">
                    기사비
                  </label>
                  <input id="pr-rate" name="technician_rate" inputMode="numeric" placeholder="기본값 유지" className="field num" />
                </div>
                <div className="form-row sm:col-span-2 lg:col-span-3">
                  <label className="label" htmlFor="pr-memo">
                    메모
                  </label>
                  <input id="pr-memo" name="memo" maxLength={200} placeholder="예: 래미안 사전점검 행사가" className="field" />
                </div>
                <div className="form-row flex items-end">
                  <SubmitButton className="btn">규칙 추가</SubmitButton>
                </div>
              </div>
            </ActionForm>
          )}
        </div>
      )}

      {/* 5. 기사별 단가 */}
      {canRates && (
        <div className="card">
          <div className="panel-head">
            <h2>
              기사별 단가 <span className="sub">{rates.length}건</span>
            </h2>
          </div>
          <p className="px-4 pt-3 text-xs text-muted">기본 기사비 {won(product.technician_rate)}원 대신 특정 기사에게 적용할 시공비입니다.</p>
          <div className="overflow-x-auto mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>기사</th>
                  <th className="text-right">단가</th>
                  <th>기간</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.technician?.name ?? "(조회 불가)"}</td>
                    <td className="num">{won(r.rate)}</td>
                    <td className="mono">{period(r.valid_from, r.valid_to)}</td>
                    {canManage && (
                      <td>
                        <form action={deleteTechnicianRate}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="product_id" value={product.id} />
                          <button className={TEXT_DANGER}>삭제</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
                {rates.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 4 : 3} className="text-muted text-center py-4">
                      기사별 단가가 없습니다. 기본 기사비가 적용됩니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {canManage && (
            <ActionForm action={createTechnicianRate} className="px-4 py-3 border-t border-border">
              <div className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="product_id" value={product.id} />
                <div className="grow min-w-[180px]">
                  <label className="label" htmlFor="tr-tech">
                    기사
                  </label>
                  <select id="tr-tech" name="technician_id" required defaultValue="" className="field">
                    <option value="" disabled>
                      기사 선택
                    </option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-[140px]">
                  <label className="label" htmlFor="tr-rate">
                    단가
                  </label>
                  <input id="tr-rate" name="rate" required inputMode="numeric" placeholder="0" className="field num" />
                </div>
                <div className="w-[150px]">
                  <label className="label" htmlFor="tr-from">
                    시작일
                  </label>
                  <input id="tr-from" name="valid_from" type="date" className="field mono" />
                </div>
                <div className="w-[150px]">
                  <label className="label" htmlFor="tr-to">
                    종료일
                  </label>
                  <input id="tr-to" name="valid_to" type="date" className="field mono" />
                </div>
                <SubmitButton className="btn">추가</SubmitButton>
              </div>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
