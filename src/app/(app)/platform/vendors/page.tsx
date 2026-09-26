import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/origin";
import { won } from "@/lib/format";
import { fmtDateTime } from "@/lib/inbox";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { setVendorListed, upsertFee } from "@/lib/actions/platform";
import { FEE_CYCLE, FEE_TYPE, categoryLabels, platformCategories } from "@/lib/market";
import { Chips } from "../shared";
import { filterParam, platformVendors, type PlatformVendor } from "../data";

export const metadata = { title: "업체·수수료" };

const FILTERS = ["all", "listed", "unlisted"] as const;

/** 수수료 한 줄 요약. 설정이 없으면 정산 함수가 기본값(계약금액 10%·월말)으로 만든다. */
function feeSummary(v: PlatformVendor): string {
  if (!v.fee_type) return "미설정 — 정산 시 기본값(계약금액 10% · 월말 정산)";
  const base = v.fee_type === "percent" ? `계약금액 ${Number(v.rate ?? 0)}%` : v.fee_type === "fixed" ? `건당 ${won(v.fixed_amount)}원` : "수수료 없음";
  const bounds = [v.min_fee != null ? `최소 ${won(v.min_fee)}원` : "", v.max_fee != null ? `최대 ${won(v.max_fee)}원` : ""].filter(Boolean).join(" · ");
  return [base, bounds, FEE_CYCLE[v.cycle ?? ""] ?? ""].filter(Boolean).join(" · ");
}

export default async function VendorsPage({ searchParams }: PageProps<"/platform/vendors">) {
  await requireTenant();
  const sp = await searchParams;
  const filter = filterParam(sp.f, FILTERS, "all");
  const supabase = await createClient();
  const [vendors, cats, origin] = await Promise.all([platformVendors(supabase), platformCategories(supabase, false), siteOrigin()]);
  const listedCount = vendors.filter((v) => v.is_listed).length;
  const rows = filter === "listed" ? vendors.filter((v) => v.is_listed) : filter === "unlisted" ? vendors.filter((v) => !v.is_listed) : vendors;

  return (
    <div>
      <Chips
        base="/platform/vendors"
        param="f"
        value={filter}
        items={[
          { key: "all", label: "전체", count: vendors.length },
          { key: "listed", label: "노출 중", count: listedCount },
          { key: "unlisted", label: "노출 대기", count: vendors.length - listedCount },
        ]}
      />
      <div className="grid gap-4 p-4">
        {rows.map((v) => {
          const id = `v-${v.tenant_id.slice(0, 8)}`;
          const inviteLink = v.pending_invite_token ? `${origin}/invite/${v.pending_invite_token}` : null;
          return (
            <div key={v.tenant_id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{v.name}</h2>
                {v.is_listed ? <span className="badge badge-done">노출 중</span> : <span className="badge badge-wait">노출 대기</span>}
                {v.tenant_status !== "active" && <span className="badge badge-risk">사업체 {v.tenant_status}</span>}
                <span className="mono text-xs text-muted">/{v.slug}</span>
                {v.is_listed && (
                  <a href={`/vendors/${v.slug}`} target="_blank" rel="noreferrer" className="text-xs">업체 페이지 열기</a>
                )}
                {v.listed_at && <span className="mono text-xs text-muted ml-auto">노출 {fmtDateTime(v.listed_at)}</span>}
              </div>
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4 text-sm mt-2">
                <div><span className="text-xs text-muted mr-2">분류</span>{categoryLabels(v.categories, cats) || <span className="text-muted">—</span>}</div>
                <div><span className="text-xs text-muted mr-2">지역</span>{v.regions.length ? v.regions.join(" · ") : <span className="text-muted">전국(미지정)</span>}</div>
                <div>
                  <span className="text-xs text-muted mr-2">구성원</span>{v.member_count}명
                  {inviteLink && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs">
                      초대 대기 <span className="text-muted">{v.pending_invite_email}</span>
                      <CopyButton text={inviteLink} label="링크 복사" />
                    </span>
                  )}
                </div>
                <div><span className="text-xs text-muted mr-2">견적</span>{v.quote_count}건 · 선택 {v.accepted_count}건</div>
              </div>
              {(v.intro || v.highlights.length > 0) && (
                <p className="text-sm text-muted mt-2 whitespace-pre-wrap">
                  {v.intro}
                  {v.highlights.length > 0 && <span className="block text-xs mt-0.5">{v.highlights.join(" · ")}</span>}
                </p>
              )}

              <div className="flex flex-wrap gap-3 items-start mt-3 pt-3 border-t border-border">
                <ActionForm action={setVendorListed}>
                  <input type="hidden" name="tenant_id" value={v.tenant_id} />
                  <input type="hidden" name="is_listed" value={v.is_listed ? "false" : "true"} />
                  <SubmitButton className={v.is_listed ? "btn btn-sm" : "btn btn-primary btn-sm"}>{v.is_listed ? "노출 끄기" : "노출 켜기"}</SubmitButton>
                </ActionForm>

                <details className="flex-1 min-w-[280px]">
                  <summary className="cursor-pointer text-sm py-1.5">
                    <span className="text-xs text-muted mr-2">수수료</span>
                    {feeSummary(v)}
                    <span className="text-xs text-accent ml-2">고치기</span>
                  </summary>
                  <ActionForm action={upsertFee} className="mt-2 p-3 border border-border rounded-sm bg-bg">
                    <input type="hidden" name="tenant_id" value={v.tenant_id} />
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-2">
                      <div className="form-row">
                        <label className="label" htmlFor={`${id}-type`}>방식</label>
                        <select id={`${id}-type`} name="fee_type" defaultValue={v.fee_type ?? "percent"} className="field">
                          {Object.entries(FEE_TYPE).map(([k, l]) => (
                            <option key={k} value={k}>{l}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-row">
                        <label className="label" htmlFor={`${id}-rate`}>비율(%) <span className="text-muted">계약금액 % 일 때</span></label>
                        <input id={`${id}-rate`} name="rate" type="number" step="0.001" min={0} max={100} defaultValue={v.rate ?? 10} className="field num" />
                      </div>
                      <div className="form-row">
                        <label className="label" htmlFor={`${id}-fixed`}>건당 정액(원) <span className="text-muted">건당 정액일 때</span></label>
                        <input id={`${id}-fixed`} name="fixed_amount" inputMode="numeric" defaultValue={v.fixed_amount ?? 0} className="field num" />
                      </div>
                      <div className="form-row">
                        <label className="label" htmlFor={`${id}-min`}>최소 수수료(원)</label>
                        <input id={`${id}-min`} name="min_fee" inputMode="numeric" defaultValue={v.min_fee ?? ""} placeholder="없음" className="field num" />
                      </div>
                      <div className="form-row">
                        <label className="label" htmlFor={`${id}-max`}>최대 수수료(원)</label>
                        <input id={`${id}-max`} name="max_fee" inputMode="numeric" defaultValue={v.max_fee ?? ""} placeholder="없음" className="field num" />
                      </div>
                      <div className="form-row">
                        <label className="label" htmlFor={`${id}-cycle`}>정산 주기</label>
                        <select id={`${id}-cycle`} name="cycle" defaultValue={v.cycle ?? "monthly"} className="field">
                          {Object.entries(FEE_CYCLE).map(([k, l]) => (
                            <option key={k} value={k}>{l}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="form-row">
                      <label className="label" htmlFor={`${id}-memo`}>메모</label>
                      <input id={`${id}-memo`} name="memo" defaultValue={v.fee_memo ?? ""} maxLength={500} placeholder="예: 첫 3개월 5% 프로모션" className="field" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SubmitButton className="btn btn-primary btn-sm">수수료 저장</SubmitButton>
                      <span className="text-xs text-muted">플랫폼 요청에서 이어진 계약(견적 → 계약)에만 붙습니다. 건별 정산은 아직 월말과 같은 방식으로 정산서를 만듭니다.</span>
                    </div>
                  </ActionForm>
                </details>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="text-sm text-muted p-4 card">
            {vendors.length === 0 ? "아직 승인된 업체가 없습니다. 신청 심사에서 승인하면 여기에 나타납니다." : "해당하는 업체가 없습니다."}
          </p>
        )}
      </div>
    </div>
  );
}
