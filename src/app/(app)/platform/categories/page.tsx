import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { toggleCategory, upsertCategory } from "@/lib/actions/platform";
import { platformCategories } from "@/lib/market";
import { EmptyRow } from "../shared";

export const metadata = { title: "서비스 분류" };

export default async function CategoriesPage() {
  await requireTenant();
  const supabase = await createClient();
  const cats = await platformCategories(supabase, false);
  const active = cats.filter((c) => c.is_active).length;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="card overflow-x-auto">
        <div className="panel-head">
          <h2>
            서비스 분류 <span className="sub">{cats.length}개 · 사용 중 {active}</span>
          </h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>코드</th>
              <th>이름</th>
              <th className="text-right">순서</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.code}>
                <td className="mono text-xs">{c.code}</td>
                <td>
                  <details>
                    <summary className="cursor-pointer font-medium">
                      {c.label} <span className="text-xs text-accent font-normal">고치기</span>
                    </summary>
                    <ActionForm action={upsertCategory} className="mt-2 flex flex-wrap gap-2 items-center">
                      <input type="hidden" name="code" value={c.code} />
                      <input name="label" defaultValue={c.label} required maxLength={40} aria-label="이름" className="field h-8 text-xs w-[180px]" />
                      <input name="sort_order" type="number" defaultValue={c.sort_order} min={0} max={9999} aria-label="순서" className="field h-8 text-xs w-[80px] num" />
                      <SubmitButton className="btn btn-sm">저장</SubmitButton>
                    </ActionForm>
                  </details>
                </td>
                <td className="num">{c.sort_order}</td>
                <td>
                  <span className={`badge badge-${c.is_active ? "done" : "wait"}`}>{c.is_active ? "사용" : "숨김"}</span>
                </td>
                <td>
                  <ActionForm action={toggleCategory}>
                    <input type="hidden" name="code" value={c.code} />
                    <input type="hidden" name="is_active" value={c.is_active ? "false" : "true"} />
                    <SubmitButton className="btn btn-sm">{c.is_active ? "숨기기" : "다시 사용"}</SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
            {cats.length === 0 && <EmptyRow cols={5}>분류가 없습니다.</EmptyRow>}
          </tbody>
        </table>
      </div>

      <ActionForm action={upsertCategory} className="card p-4">
        <h2 className="text-sm font-semibold mb-1">분류 추가</h2>
        <p className="text-xs text-muted mb-3">
          고객 요청·업체 소개·광고(분류 화면)에서 고르는 서비스 분류입니다. 코드는 영문 소문자·밑줄만(예: window_film). 이미 있는 코드로 저장하면 이름·순서가 바뀝니다. 숨긴
          분류는 새로 고를 수 없지만 기존 데이터의 값은 그대로 남습니다.
        </p>
        <div className="form-row">
          <label className="label" htmlFor="cat-code">코드<span className="req">*</span></label>
          <input id="cat-code" name="code" required pattern="[a-z_]{2,40}" placeholder="window_film" className="field mono" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="cat-label">이름<span className="req">*</span></label>
          <input id="cat-label" name="label" required maxLength={40} placeholder="창문 필름" className="field" />
        </div>
        <div className="form-row">
          <label className="label" htmlFor="cat-sort">순서</label>
          <input id="cat-sort" name="sort_order" type="number" min={0} max={9999} defaultValue={cats.length ? Math.max(...cats.map((c) => c.sort_order)) + 1 : 1} className="field num" />
        </div>
        <SubmitButton className="btn btn-primary btn-sm">추가</SubmitButton>
      </ActionForm>
    </div>
  );
}
