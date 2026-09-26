import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { shortDate, won } from "@/lib/format";
import { addDays, todayKST } from "@/lib/dates";
import { PLACEMENT, PROMOTION_KIND, PROMOTION_STATUS, platformCategories } from "@/lib/market";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { cancelPromotion, requestPromotion } from "@/lib/actions/market";
import { PlacementFields } from "./placement-fields";

export const metadata = { title: "상단 노출" };

type Promotion = {
  id: string;
  kind: string;
  placement: string;
  category_code: string | null;
  starts_on: string;
  ends_on: string;
  price: number | null;
  status: string;
  note: string | null;
  billed_settlement_id: string | null;
  decided_at: string | null;
  created_at: string;
};

export default async function PromotionsPage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const canWrite = session.can("market.write");
  const supabase = await createClient();
  const today = todayKST();
  const [{ data: rows }, cats] = await Promise.all([
    supabase
      .from("vendor_promotion")
      .select("id, kind, placement, category_code, starts_on, ends_on, price, status, note, billed_settlement_id, decided_at, created_at")
      .eq("tenant_id", tid)
      .order("starts_on", { ascending: false })
      .limit(200),
    platformCategories(supabase, true),
  ]);
  const list = (rows ?? []) as Promotion[];
  const catLabel = new Map(cats.map((c) => [c.code, c.label]));
  const running = list.filter((p) => p.status === "approved" && p.starts_on <= today && p.ends_on >= today);

  return (
    <div className={"grid gap-4 p-4 items-start" + (canWrite ? " lg:grid-cols-[1fr_360px]" : "")}>
      <div className="grid gap-4">
        {running.length > 0 && (
          <p className="notice notice-success">
            지금 노출 중: {running.map((p) => `${PROMOTION_KIND[p.kind] ?? p.kind} · ${PLACEMENT[p.placement] ?? p.placement}${p.category_code ? ` (${catLabel.get(p.category_code) ?? p.category_code})` : ""} ~${p.ends_on}`).join(", ")}
          </p>
        )}
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>종류</th>
                <th>위치</th>
                <th>기간</th>
                <th className="text-right">금액</th>
                <th>상태</th>
                <th>메모</th>
                <th>신청일</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const st = PROMOTION_STATUS[p.status] ?? { label: p.status, badge: "wait" as const };
                const live = p.status === "approved" && p.starts_on <= today && p.ends_on >= today;
                return (
                  <tr key={p.id} className={live ? "is-selected" : ""}>
                    <td className="text-xs font-medium">{PROMOTION_KIND[p.kind] ?? p.kind}</td>
                    <td className="text-xs">
                      {PLACEMENT[p.placement] ?? p.placement}
                      {p.category_code && <span className="text-muted"> · {catLabel.get(p.category_code) ?? p.category_code}</span>}
                    </td>
                    <td className="mono text-xs whitespace-nowrap">{p.starts_on} ~ {p.ends_on}</td>
                    <td className={`num ${p.price != null ? "" : "zero"}`}>{p.price != null ? won(p.price) : "승인 시 확정"}</td>
                    <td>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`badge badge-${st.badge}`}>{live ? "노출 중" : st.label}</span>
                        {p.billed_settlement_id && <span className="badge badge-wait">정산서 반영</span>}
                      </div>
                    </td>
                    <td className="text-xs text-muted max-w-[240px]">{p.note ?? <span className="zero">—</span>}</td>
                    <td className="mono text-xs text-muted whitespace-nowrap">{shortDate(p.created_at)}</td>
                    {canWrite && (
                      <td>
                        {p.status === "requested" && (
                          <ActionForm action={cancelPromotion}>
                            <input type="hidden" name="id" value={p.id} />
                            <SubmitButton className="btn btn-sm btn-danger">취소</SubmitButton>
                          </ActionForm>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 8 : 7} className="text-muted">아직 신청한 상단 노출이 없습니다.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={canWrite ? 8 : 7}>{list.length}건 · 승인·반려되면 알림이 옵니다. 승인된 광고비는 그 기간이 시작되는 달의 정산서에 합산됩니다.</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {canWrite && (
        <ActionForm action={requestPromotion} className="card p-4">
          <h2 className="text-sm font-semibold mb-1">상단 노출 신청</h2>
          <p className="text-xs text-muted mb-3">고객이 업체를 고르는 첫 화면이나 분류 화면의 위쪽에 우리 업체를 올립니다. 금액은 집대리 운영자가 승인하며 확정하고, 승인되면 정산서에 광고비가 합산됩니다.</p>
          <div className="form-row">
            <label className="label" htmlFor="promo-kind">종류</label>
            <select id="promo-kind" name="kind" className="field" defaultValue="featured">
              {Object.entries(PROMOTION_KIND).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <PlacementFields categories={cats.map((c) => ({ code: c.code, label: c.label }))} />
          <div className="grid grid-cols-2 gap-x-2">
            <div className="form-row">
              <label className="label" htmlFor="promo-start">시작<span className="req">*</span></label>
              <input id="promo-start" type="date" name="starts_on" required min={today} defaultValue={addDays(today, 1)} className="field mono" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="promo-end">끝<span className="req">*</span></label>
              <input id="promo-end" type="date" name="ends_on" required min={today} defaultValue={addDays(today, 7)} className="field mono" />
            </div>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="promo-note">메모 (운영자에게)</label>
            <textarea id="promo-note" name="note" rows={2} maxLength={500} placeholder="예: 10월 입주 시즌 대구 지역 집중" className="field" />
          </div>
          <SubmitButton>신청</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
