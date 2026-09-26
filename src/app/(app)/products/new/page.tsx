import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createProduct } from "@/lib/actions/products";
import { ProductFields, type CategoryOption } from "../_components/product-ui";

export const metadata = { title: "상품 등록" };

export default async function NewProductPage() {
  const session = await requireTenant();
  if (!session.can("product.manage")) redirect("/products");
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const [{ data: categories }, workAreas] = await Promise.all([
    supabase
      .from("product_category")
      .select("id, name")
      .eq("tenant_id", tid)
      .is("deleted_at", null)
      .order("sort_order")
      .order("name"),
    codeValues(tid, "work_area"),
  ]);

  return (
    <div className="max-w-[760px]">
      <div className="card">
        <div className="panel-head">
          <h2>상품 등록</h2>
        </div>
        <ActionForm action={createProduct} className="p-4">
          <ProductFields categories={(categories ?? []) as CategoryOption[]} workAreas={workAreas} />
          <div className="flex gap-2 mt-1">
            <SubmitButton>등록</SubmitButton>
            <Link href="/products" className="btn">
              취소
            </Link>
          </div>
          <p className="text-xs text-muted mt-3">등록 후 상세 화면에서 옵션·패키지 구성·가격 규칙·기사별 단가를 붙입니다.</p>
        </ActionForm>
      </div>
    </div>
  );
}
