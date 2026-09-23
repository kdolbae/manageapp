import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createCategory, updateCategory } from "@/lib/actions/products";

export const metadata = { title: "상품 카테고리" };

type Category = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  deleted_at: string | null;
};

export default async function CategoriesPage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from("product_category").select("id, code, name, sort_order, deleted_at").eq("tenant_id", tid).order("sort_order").order("name"),
    supabase.from("product").select("category_id").eq("tenant_id", tid).is("deleted_at", null),
  ]);
  const counts = new Map<string, number>();
  for (const p of (products ?? []) as { category_id: string | null }[]) {
    if (p.category_id) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  }
  // 사용 중인 카테고리 먼저, 보관된 것은 아래에
  const all = (categories ?? []) as Category[];
  const list = [...all.filter((c) => !c.deleted_at), ...all.filter((c) => c.deleted_at)];
  const activeCount = all.filter((c) => !c.deleted_at).length;
  const editable = session.can("product.manage");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] items-start">
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>코드</th>
              <th>카테고리</th>
              <th className="text-right">순서</th>
              <th className="text-right">상품 수</th>
              <th>상태</th>
              {editable && <th></th>}
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const archived = Boolean(c.deleted_at);
              const count = counts.get(c.id) ?? 0;
              return (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td className="font-semibold">
                    {archived ? <span className="text-muted">{c.name}</span> : <Link href={`/products?category=${c.id}`}>{c.name}</Link>}
                  </td>
                  <td className="num">{c.sort_order}</td>
                  <td className="num">{count === 0 ? <span className="zero">0</span> : count}</td>
                  <td>
                    <span className={"badge " + (archived ? "badge-wait" : "badge-done")}>{archived ? "보관" : "사용"}</span>
                  </td>
                  {editable && (
                    <td>
                      <details>
                        <summary className="cursor-pointer text-accent text-xs">수정</summary>
                        <ActionForm action={updateCategory} className="mt-2 grid gap-2 min-w-[220px]">
                          <input type="hidden" name="id" value={c.id} />
                          <input name="name" defaultValue={c.name} required maxLength={40} placeholder="카테고리 이름" className="field" />
                          <input name="sort_order" type="number" step={1} defaultValue={c.sort_order} placeholder="순서" className="field num" />
                          <select name="status" defaultValue={archived ? "archived" : "active"} className="field">
                            <option value="active">사용</option>
                            <option value="archived">보관 (상품이 없을 때만)</option>
                          </select>
                          <SubmitButton className="btn btn-sm">저장</SubmitButton>
                        </ActionForm>
                      </details>
                    </td>
                  )}
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={editable ? 6 : 5} className="text-center text-muted py-8">
                  카테고리가 없습니다.{editable && " 오른쪽에서 추가합니다."}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={editable ? 6 : 5}>
                {activeCount}개 카테고리{all.length > activeCount ? ` · 보관 ${all.length - activeCount}개` : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {editable && (
        <ActionForm action={createCategory} className="card p-4">
          <h2 className="text-sm font-semibold mb-1">카테고리 추가</h2>
          <p className="text-xs text-muted mb-3">상품 목록의 왼쪽 필터와 상품 등록의 카테고리 선택에 쓰입니다. 순서가 작을수록 앞에 옵니다.</p>
          <div className="form-row">
            <label className="label" htmlFor="c-code">
              코드<span className="req">*</span>
            </label>
            <input id="c-code" name="code" required pattern="[A-Za-z0-9_.\-]{1,30}" placeholder="예: CLEAN" className="field mono" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="c-name">
              이름<span className="req">*</span>
            </label>
            <input id="c-name" name="name" required maxLength={40} placeholder="예: 청소" className="field" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="c-sort">
              순서
            </label>
            <input id="c-sort" name="sort_order" type="number" step={1} defaultValue={0} className="field num" />
          </div>
          <SubmitButton>추가</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
