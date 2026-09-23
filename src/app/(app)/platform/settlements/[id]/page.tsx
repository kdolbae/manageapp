import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { fmtDateTime } from "@/lib/inbox";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Crumb, KV } from "@/app/(app)/people/shared";
import { addAdjustLine, deleteLine, setSettlementStatus, updateSettlementMemo } from "@/lib/actions/platform";
import { FEE_CYCLE, FEE_TYPE, SETTLEMENT_STATUS } from "@/lib/market";
import { EmptyRow, StatusBadge } from "../../shared";
import { LINE_KIND, LINE_SELECT, PLATFORM_VENDOR_SELECT, SETTLEMENT_SELECT, UUID, type PlatformVendor, type Settlement, type SettlementLine } from "../../data";

export const metadata = { title: "플랫폼 정산서" };

const KIND_BADGE: Record<string, string> = { fee: "run", ad: "done", adjust: "wait" };

export default async function SettlementPage({ params }: PageProps<"/platform/settlements/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requireTenant();
  const supabase = await createClient();
  const [{ data }, { data: lRows }] = await Promise.all([
    supabase.from("platform_settlement").select(SETTLEMENT_SELECT).eq("id", id).maybeSingle(),
    supabase.from("platform_settlement_line").select(LINE_SELECT).eq("settlement_id", id).order("created_at"),
  ]);
  if (!data) notFound();
  const s = data as Settlement;
  const lines = (lRows ?? []) as SettlementLine[];
  const { data: vRow } = await supabase.from("platform_vendor").select(PLATFORM_VENDOR_SELECT).eq("tenant_id", s.tenant_id).maybeSingle();
  const v = (vRow ?? null) as unknown as PlatformVendor | null;
  const vendorLabel = v?.name ?? `업체 ${s.tenant_id.slice(0, 8)}`;
  const draft = s.status === "draft";
  const issued = s.status === "issued";
  const isVoid = s.status === "void";
  const cols = draft ? 6 : 5;
  const count = (k: string) => lines.filter((l) => l.kind === k).length;
  const feeText = v?.fee_type
    ? `${FEE_TYPE[v.fee_type] ?? v.fee_type}${v.fee_type === "percent" ? ` ${Number(v.rate ?? 0)}%` : v.fee_type === "fixed" ? ` ${won(v.fixed_amount)}원` : ""} · ${FEE_CYCLE[v.cycle ?? ""] ?? ""}`
    : "미설정(기본 10%)";

  return (
    <div className="p-4">
      <Crumb href="/platform/settlements" parent="정산" current={`${vendorLabel} · ${s.period_from} ~ ${s.period_to}`} />
      <div className={"grid gap-4 items-start" + (isVoid ? "" : " lg:grid-cols-[1fr_340px]")}>
        <div className="grid gap-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="text-base font-semibold">{vendorLabel} 정산서</h2>
              <StatusBadge s={SETTLEMENT_STATUS[s.status]} fallback={s.status} />
              <span className="mono text-xs text-muted">
                {s.period_from} ~ {s.period_to}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 border border-border rounded-sm mb-3">
              <div className="stat">
                <div className="k">수수료</div>
                <div className={`v ${Number(s.fee_total) ? "" : "zero"}`}>{won(s.fee_total)}</div>
              </div>
              <div className="stat">
                <div className="k">광고</div>
                <div className={`v ${Number(s.ad_total) ? "" : "zero"}`}>{won(s.ad_total)}</div>
              </div>
              <div className="stat">
                <div className="k">조정</div>
                <div className={`v ${Number(s.adjust_total) < 0 ? "text-danger" : Number(s.adjust_total) ? "" : "zero"}`}>{won(s.adjust_total)}</div>
              </div>
              <div className="stat">
                <div className="k">청구 합계</div>
                <div className={`v ${Number(s.total) ? "text-success" : "zero"}`}>{won(s.total)}</div>
              </div>
            </div>
            <KV k="업체">
              {vendorLabel}
              {v && <span className="text-xs text-muted ml-2">/{v.slug} · 구성원 {v.member_count}명</span>}
            </KV>
            <KV k="수수료 설정">
              {feeText}
              {draft && <span className="text-xs text-muted ml-2">(항목은 만들 때 계산됐습니다. 설정을 바꿨으면 무효 처리 뒤 다시 만드세요)</span>}
            </KV>
            <KV k="발행">{s.issued_at ? <span className="mono">{fmtDateTime(s.issued_at)}</span> : <span className="text-muted">—</span>}</KV>
            <KV k="입금">{s.paid_at ? <span className="mono">{fmtDateTime(s.paid_at)}</span> : <span className="text-muted">—</span>}</KV>
            <KV k="만든 날">
              <span className="mono text-xs">{fmtDateTime(s.created_at)}</span>
            </KV>
            {s.memo && <KV k="메모"><span className="whitespace-pre-wrap">{s.memo}</span></KV>}
          </div>

          <div className="card overflow-x-auto">
            <div className="panel-head">
              <h2>
                항목 <span className="sub">수수료 {count("fee")} · 광고 {count("ad")} · 조정 {count("adjust")}</span>
              </h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>내용</th>
                  <th className="text-right">기준 금액</th>
                  <th className="text-right">청구</th>
                  <th>일자</th>
                  {draft && <th></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td><span className={`badge badge-${KIND_BADGE[l.kind] ?? "wait"}`}>{LINE_KIND[l.kind] ?? l.kind}</span></td>
                    <td className="text-xs">
                      {l.description}
                      {l.ref_type && <span className="mono text-muted ml-1">({l.ref_type})</span>}
                    </td>
                    <td className={`num ${Number(l.basis_amount) ? "" : "zero"}`}>{won(l.basis_amount)}</td>
                    <td className={`num ${Number(l.fee_amount) < 0 ? "text-danger" : ""}`}>{won(l.fee_amount)}</td>
                    <td className="mono text-xs text-muted whitespace-nowrap">{fmtDateTime(l.created_at)}</td>
                    {draft && (
                      <td>
                        <ActionForm action={deleteLine}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="settlement_id" value={s.id} />
                          <SubmitButton className="btn btn-sm btn-danger">빼기</SubmitButton>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
                {lines.length === 0 && (
                  <EmptyRow cols={cols}>기간 안에 정산할 플랫폼 계약·광고가 없습니다.{draft && " 조정 항목을 더하거나 무효 처리하세요."}</EmptyRow>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={cols}>
                    {lines.length}항목 · 합계 {won(s.total)}원{draft ? " · 뺀 계약·광고는 다음 정산서를 만들 때 다시 잡힙니다" : " · 발행된 정산서의 항목은 고칠 수 없습니다"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {!isVoid && (
          <div className="grid gap-4">
            {draft && (
              <>
                <ActionForm action={addAdjustLine} className="card p-4">
                  <h2 className="text-sm font-semibold mb-1">조정 항목 더하기</h2>
                  <p className="text-xs text-muted mb-3">할인·감면은 음수, 추가 청구는 양수. 합계는 자동으로 다시 계산됩니다.</p>
                  <input type="hidden" name="settlement_id" value={s.id} />
                  <div className="form-row">
                    <label className="label" htmlFor="adj-desc">내용<span className="req">*</span></label>
                    <input id="adj-desc" name="description" required maxLength={200} placeholder="예: 첫 달 수수료 50% 감면" className="field" />
                  </div>
                  <div className="form-row">
                    <label className="label" htmlFor="adj-amount">금액(원)<span className="req">*</span></label>
                    <input id="adj-amount" name="fee_amount" required inputMode="numeric" placeholder="-15,000" className="field num" />
                  </div>
                  <SubmitButton className="btn">더하기</SubmitButton>
                </ActionForm>

                <details className="card p-4">
                  <summary className="cursor-pointer text-sm font-semibold">발행</summary>
                  <ActionForm action={setSettlementStatus} className="mt-2">
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="status" value="issued" />
                    <p className="text-xs text-muted mb-2">
                      합계 {won(s.total)}원을 {vendorLabel}에 청구합니다. 발행하면 항목을 고칠 수 없고, 업체의 정산 조회 권한자에게 앱 알림이 갑니다. 되돌리려면 무효 처리 뒤 다시
                      만드세요.
                    </p>
                    <SubmitButton className="btn btn-primary btn-sm">정산서 발행</SubmitButton>
                  </ActionForm>
                </details>
              </>
            )}

            {issued && (
              <details className="card p-4" open>
                <summary className="cursor-pointer text-sm font-semibold">입금 확인</summary>
                <ActionForm action={setSettlementStatus} className="mt-2">
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="status" value="paid" />
                  <p className="text-xs text-muted mb-2">{vendorLabel}에서 {won(s.total)}원이 들어온 것을 확인한 뒤 기록합니다. 기록 뒤에는 무효 처리만 할 수 있습니다.</p>
                  <SubmitButton className="btn btn-primary btn-sm">입금 확인으로 기록</SubmitButton>
                </ActionForm>
              </details>
            )}

            <ActionForm action={updateSettlementMemo} className="card p-4">
              <h2 className="text-sm font-semibold mb-1">메모</h2>
              <input type="hidden" name="id" value={s.id} />
              <div className="form-row">
                <textarea name="memo" rows={3} maxLength={1000} defaultValue={s.memo ?? ""} placeholder="입금 계좌·세금계산서 발행 여부 등" className="field" />
              </div>
              <SubmitButton className="btn btn-sm">메모 저장</SubmitButton>
            </ActionForm>

            <details className="card p-4">
              <summary className="cursor-pointer text-danger text-sm">무효 처리</summary>
              <ActionForm action={setSettlementStatus} className="mt-2">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="status" value="void" />
                <p className="text-xs text-muted mb-2">
                  정산서를 무효로 표시합니다(지우지 않고 남습니다). 이 정산서에 잡혔던 계약 수수료와 광고는 다음 정산서를 만들 때 다시 잡힙니다.
                  {s.status === "paid" && " 입금 완료된 정산서를 무효로 하면 환불·재발행은 따로 처리해야 합니다."}
                </p>
                <SubmitButton className="btn btn-sm btn-danger">무효 처리</SubmitButton>
              </ActionForm>
            </details>
            <Link href="/platform/settlements" className="btn">목록으로</Link>
          </div>
        )}
      </div>
      {isVoid && (
        <div className="mt-4">
          <Link href="/platform/settlements" className="btn">목록으로</Link>
        </div>
      )}
    </div>
  );
}
