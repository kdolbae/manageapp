import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { fmtDateTime } from "@/lib/inbox";
import { ActionForm } from "@/components/action-form";
import { FormButton } from "@/app/(app)/groupware/ui";
import { decidePromotion } from "@/lib/actions/platform";
import { PLACEMENT, PROMOTION_KIND, PROMOTION_STATUS, categoryLabels, platformCategories } from "@/lib/market";
import { Chips, StatusBadge } from "../shared";
import { PROMOTION_SELECT, filterParam, platformVendors, statusCounts, type Promotion, vendorName, vendorNameMap } from "../data";

export const metadata = { title: "광고(상단 노출)" };

const FILTERS = ["requested", "approved", "rejected", "canceled", "all"] as const;

/** 시작일~종료일 일수 (양 끝 포함) */
function days(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

export default async function PromotionsPage({ searchParams }: PageProps<"/platform/promotions">) {
  await requireTenant();
  const sp = await searchParams;
  const filter = filterParam(sp.s, FILTERS, "requested");
  const supabase = await createClient();
  const base = supabase.from("vendor_promotion").select(PROMOTION_SELECT);
  const [{ data }, vendors, cats, counts] = await Promise.all([
    (filter === "all" ? base : base.eq("status", filter)).order("created_at", { ascending: false }).limit(200),
    platformVendors(supabase),
    platformCategories(supabase, false),
    statusCounts(supabase, "vendor_promotion", ["requested", "approved", "rejected", "canceled"]),
  ]);
  const rows = (data ?? []) as Promotion[];
  const names = vendorNameMap(vendors);

  return (
    <div>
      <Chips
        base="/platform/promotions"
        param="s"
        value={filter}
        items={[
          { key: "requested", label: "신청", count: counts.requested },
          { key: "approved", label: "승인", count: counts.approved },
          { key: "rejected", label: "반려", count: counts.rejected },
          { key: "canceled", label: "취소", count: counts.canceled },
          { key: "all", label: "전체" },
        ]}
      />
      <div className="grid gap-4 p-4">
        {rows.map((p) => {
          const where = `${PROMOTION_KIND[p.kind] ?? p.kind} · ${PLACEMENT[p.placement] ?? p.placement}${p.category_code ? ` · ${categoryLabels([p.category_code], cats)}` : ""}`;
          return (
            <div key={p.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{vendorName(names, p.tenant_id)}</h2>
                <span className="badge badge-wait">{where}</span>
                <StatusBadge s={PROMOTION_STATUS[p.status]} fallback={p.status} />
                <span className="mono text-xs text-muted ml-auto">{fmtDateTime(p.created_at)} 신청</span>
              </div>
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3 text-sm mt-2">
                <div>
                  <span className="text-xs text-muted mr-2">기간</span>
                  <span className="mono">
                    {p.starts_on} ~ {p.ends_on}
                  </span>{" "}
                  <span className="text-xs text-muted">({days(p.starts_on, p.ends_on)}일)</span>
                </div>
                <div>
                  <span className="text-xs text-muted mr-2">금액</span>
                  {p.price != null ? <span className="mono">{won(p.price)}원</span> : <span className="text-muted">미정 (승인하며 확정)</span>}
                </div>
                <div>
                  <span className="text-xs text-muted mr-2">청구</span>
                  {p.billed_settlement_id ? (
                    <Link href={`/platform/settlements/${p.billed_settlement_id}`}>정산서에 잡힘</Link>
                  ) : (
                    <span className="text-muted">{p.status === "approved" ? "다음 정산서(시작일 기준)" : "—"}</span>
                  )}
                </div>
              </div>
              {p.note && (
                <p className="text-sm mt-2">
                  <span className="text-xs text-muted mr-2">메모</span>
                  {p.note}
                </p>
              )}
              {p.decided_at && <p className="mono text-xs text-muted mt-1">{fmtDateTime(p.decided_at)} 처리</p>}

              {p.status === "requested" && (
                <ActionForm action={decidePromotion} className="mt-3 pt-3 border-t border-border">
                  <input type="hidden" name="id" value={p.id} />
                  <div className="grid gap-x-2 md:grid-cols-2">
                    <div className="form-row">
                      <label className="label" htmlFor={`price-${p.id}`}>
                        광고 금액(원) <span className="text-muted">승인할 때 필수</span>
                      </label>
                      <input id={`price-${p.id}`} name="price" inputMode="numeric" placeholder="예: 50,000" className="field num" />
                    </div>
                    <div className="form-row">
                      <label className="label" htmlFor={`note-${p.id}`}>
                        메모 <span className="text-muted">업체 알림에 함께 감</span>
                      </label>
                      <input id={`note-${p.id}`} name="note" maxLength={500} className="field" placeholder="예: 첫 화면 상단 1주, 부가세 별도" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <FormButton name="decision" value="approved" className="btn btn-primary btn-sm">승인 (금액 확정)</FormButton>
                    <FormButton name="decision" value="rejected" className="btn btn-danger btn-sm">반려</FormButton>
                  </div>
                </ActionForm>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="text-sm text-muted p-4 card">
            {filter === "requested" ? "대기 중인 광고 신청이 없습니다." : "해당하는 광고가 없습니다."} 업체는 집대리 마켓 메뉴에서 상단 노출·배너를 신청하고, 승인된 광고는 노출
            업체 카드에 &lsquo;추천&rsquo;으로 표시되며 시작일이 든 기간의 정산서에 청구됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
