import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { addDays, todayKST } from "@/lib/dates";
import { monthEnd, monthStart } from "@/lib/stats";
import { fmtDateTime } from "@/lib/inbox";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { buildSettlement } from "@/lib/actions/platform";
import { FEE_TYPE, SETTLEMENT_STATUS } from "@/lib/market";
import { Chips, EmptyRow, StatusBadge } from "../shared";
import { SETTLEMENT_SELECT, filterParam, platformVendors, statusCounts, type Settlement, vendorName, vendorNameMap } from "../data";

export const metadata = { title: "플랫폼 정산" };

const FILTERS = ["all", "draft", "issued", "paid", "void"] as const;

export default async function SettlementsPage({ searchParams }: PageProps<"/platform/settlements">) {
  await requireTenant();
  const sp = await searchParams;
  const filter = filterParam(sp.s, FILTERS, "all");
  const preset = typeof sp.t === "string" ? sp.t : "";
  const supabase = await createClient();
  const base = supabase.from("platform_settlement").select(SETTLEMENT_SELECT);
  const [{ data }, vendors, counts] = await Promise.all([
    (filter === "all" ? base : base.eq("status", filter)).order("created_at", { ascending: false }).limit(200),
    platformVendors(supabase),
    statusCounts(supabase, "platform_settlement", ["draft", "issued", "paid", "void"]),
  ]);
  const rows = (data ?? []) as Settlement[];
  const names = vendorNameMap(vendors);
  // 기본 기간: 지난달 1일 ~ 말일
  const lastMonthDay = addDays(monthStart(todayKST()), -1);
  const defFrom = monthStart(lastMonthDay);
  const defTo = monthEnd(lastMonthDay);
  const unpaid = rows.filter((s) => s.status === "issued").reduce((sum, s) => sum + Number(s.total ?? 0), 0);
  const zeroOr = (v: number | null, cls = "") => (Number(v) ? <span className={cls}>{won(v)}</span> : <span className="zero">0</span>);

  return (
    <div>
      <Chips
        base="/platform/settlements"
        param="s"
        value={filter}
        items={[
          { key: "all", label: "전체" },
          { key: "draft", label: "작성 중", count: counts.draft },
          { key: "issued", label: "발행(미입금)", count: counts.issued },
          { key: "paid", label: "입금 완료", count: counts.paid },
          { key: "void", label: "무효", count: counts.void },
        ]}
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_360px] items-start">
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>업체</th>
                <th>기간</th>
                <th>상태</th>
                <th className="text-right">수수료</th>
                <th className="text-right">광고</th>
                <th className="text-right">조정</th>
                <th className="text-right">합계</th>
                <th>발행</th>
                <th>입금</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/platform/settlements/${s.id}`} className="font-semibold text-text no-underline">{vendorName(names, s.tenant_id)}</Link>
                  </td>
                  <td className="mono text-xs whitespace-nowrap">
                    <Link href={`/platform/settlements/${s.id}`}>
                      {s.period_from} ~ {s.period_to}
                    </Link>
                  </td>
                  <td><StatusBadge s={SETTLEMENT_STATUS[s.status]} fallback={s.status} /></td>
                  <td className="num">{zeroOr(s.fee_total)}</td>
                  <td className="num">{zeroOr(s.ad_total)}</td>
                  <td className="num">{zeroOr(s.adjust_total, Number(s.adjust_total) < 0 ? "text-danger" : "")}</td>
                  <td className="num font-semibold">{zeroOr(s.total)}</td>
                  <td className="mono text-xs text-muted whitespace-nowrap">{s.issued_at ? fmtDateTime(s.issued_at) : "—"}</td>
                  <td className="mono text-xs text-muted whitespace-nowrap">{s.paid_at ? fmtDateTime(s.paid_at) : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <EmptyRow cols={9}>{filter === "all" ? "아직 정산서가 없습니다. 오른쪽에서 업체와 기간을 골라 만드세요." : "해당하는 정산서가 없습니다."}</EmptyRow>}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={9}>
                  {rows.length}건{rows.length === 200 ? " (최근 200건만)" : ""}
                  {unpaid > 0 && ` · 발행 후 미입금 ${won(unpaid)}원`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <ActionForm action={buildSettlement} className="card p-4">
          <h2 className="text-sm font-semibold mb-1">정산서 만들기</h2>
          <p className="text-xs text-muted mb-3">
            기간 안 계약일의 플랫폼 계약(고객이 선택한 견적 → 계약으로 전환된 건)에 업체 수수료 설정을 적용하고, 기간에 시작하는 승인 광고를 더합니다. 다른 정산서(무효
            제외)에 이미 잡힌 건은 빠집니다. 작성 중 상태로 만들어지며 발행 전까지 항목을 고칠 수 있습니다.
          </p>
          <div className="form-row">
            <label className="label" htmlFor="st-vendor">업체<span className="req">*</span></label>
            <select id="st-vendor" name="tenant_id" required defaultValue={preset} className="field">
              <option value="">업체 선택</option>
              {vendors.map((v) => (
                <option key={v.tenant_id} value={v.tenant_id}>
                  {v.name}
                  {v.is_listed ? "" : " (노출 대기)"} · {v.fee_type ? (FEE_TYPE[v.fee_type] ?? v.fee_type) : "수수료 미설정(기본 10%)"}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-x-2">
            <div className="form-row">
              <label className="label" htmlFor="st-from">시작일<span className="req">*</span></label>
              <input id="st-from" name="period_from" type="date" required defaultValue={defFrom} className="field mono" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="st-to">종료일<span className="req">*</span></label>
              <input id="st-to" name="period_to" type="date" required defaultValue={defTo} className="field mono" />
            </div>
          </div>
          <SubmitButton pendingText="만드는 중…">정산서 만들기</SubmitButton>
          {vendors.length === 0 && <p className="text-xs text-muted mt-2">승인된 업체가 없습니다.</p>}
        </ActionForm>
      </div>
    </div>
  );
}
