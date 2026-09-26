import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { todayKST, addDays } from "@/lib/dates";
import { monthStart, monthEnd, sum } from "@/lib/stats";
import { fmtDateTime } from "@/lib/inbox";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { buildPayout } from "@/lib/actions/finance";
import { PAYOUT_STATUS, RATE_TYPE } from "@/lib/finance";

export const metadata = { title: "기사 정산" };

type PayoutRow = {
  id: string;
  technician_id: string;
  period_from: string;
  period_to: string;
  rate_type: string;
  gross: number;
  withholding: number;
  vat: number;
  net: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  technician: { name: string } | null;
  branch: { name: string } | null;
};
type Tech = { id: string; name: string; rate_type: string };

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "draft", label: "작성 중" },
  { key: "confirmed", label: "확정" },
  { key: "paid", label: "지급" },
];

export default async function PayoutsPage({ searchParams }: PageProps<"/finance/payouts">) {
  const session = await requireTenant();
  const canApprove = session.can("payout.approve");
  const isTechnician = session.current.role.code === "technician";
  if (!session.can("payout.read") && !canApprove && !isTechnician) return <p className="p-4 text-sm text-muted">기사 정산을 볼 수 있는 권한이 없습니다.</p>;
  const sp = await searchParams;
  const s = typeof sp.s === "string" && FILTERS.some((f) => f.key === sp.s) ? sp.s : "all";
  const tid = session.current.tenant_id;
  const supabase = await createClient();
  const today = todayKST();
  const lastFrom = monthStart(addDays(monthStart(today), -1));
  const lastTo = monthEnd(lastFrom);

  const [{ data: rows }, { data: techRows }] = await Promise.all([
    supabase
      .from("payout")
      .select("id, technician_id, period_from, period_to, rate_type, gross, withholding, vat, net, status, paid_at, created_at, technician:technician(name), branch:branch(name)")
      .eq("tenant_id", tid)
      .order("period_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300),
    canApprove
      ? supabase.from("technician").select("id, name, rate_type").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("sort_order").order("name")
      : Promise.resolve({ data: [] as Tech[] }),
  ]);
  const all = (rows ?? []) as unknown as PayoutRow[];
  const list = s === "all" ? all : all.filter((p) => p.status === s);
  const techs = (techRows ?? []) as Tech[];
  const countOf = (key: string) => (key === "all" ? all.length : all.filter((p) => p.status === key).length);
  const showBranch = all.some((p) => p.branch);
  const cols = showBranch ? 8 : 7;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/finance/payouts?s=${f.key}`} className={`chip ${s === f.key ? "is-active" : ""}`}>
            {f.label}
            <span className="mono text-[11px] text-muted">{countOf(f.key)}</span>
          </Link>
        ))}
        {isTechnician && !canApprove && <span className="text-xs text-muted ml-auto">내 정산서만 보입니다.</span>}
      </div>

      <div className={"grid gap-4 p-4 items-start" + (canApprove ? " lg:grid-cols-[1fr_340px]" : "")}>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>기사</th>
                <th>기간</th>
                {showBranch && <th>지점</th>}
                <th>정산 방식</th>
                <th className="text-right">지급 대상</th>
                <th className="text-right">원천징수 · 부가세</th>
                <th className="text-right">실지급</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const st = PAYOUT_STATUS[p.status] ?? { label: p.status, badge: "wait" as const };
                const withholding = Number(p.withholding);
                const vat = Number(p.vat);
                return (
                  <tr key={p.id}>
                    <td className="font-semibold"><Link href={`/finance/payouts/${p.id}`}>{p.technician?.name ?? "(시공자)"}</Link></td>
                    <td className="mono text-xs whitespace-nowrap">{p.period_from} ~ {p.period_to}</td>
                    {showBranch && <td className="text-xs">{p.branch?.name ?? "본사 공통"}</td>}
                    <td className="text-xs">{RATE_TYPE[p.rate_type] ?? p.rate_type}</td>
                    <td className="num">{won(p.gross)}</td>
                    <td className="num text-xs">
                      {withholding > 0 && <span className="text-danger">-{won(withholding)}</span>}
                      {vat > 0 && <span>+{won(vat)}</span>}
                      {!withholding && !vat && <span className="zero">—</span>}
                    </td>
                    <td className="num font-semibold">{won(p.net)}</td>
                    <td>
                      <span className={`badge badge-${st.badge}`}>{st.label}</span>
                      {p.paid_at && <div className="text-[11px] text-muted mt-1">{fmtDateTime(p.paid_at)}</div>}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={cols} className="text-center text-muted py-6">
                    정산서가 없습니다.{canApprove && " 오른쪽에서 만듭니다."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={cols}>
                  {list.length}건 · 지급 대상 {won(sum(list, (p) => p.gross))}원 · 실지급 {won(sum(list, (p) => p.net))}원
                  {all.length >= 300 ? " · 최근 300건까지만 보입니다" : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {canApprove && (
          <ActionForm action={buildPayout} className="card p-4">
            <h2 className="text-sm font-semibold mb-1">정산서 만들기</h2>
            <p className="text-xs text-muted mb-3">
              기간 안에 완료된 시공 건의 품목 기사비만 모읍니다. 이미 다른 정산서에 들어간 건은 빠지고, 일당·추가·공제 줄은 만든 뒤에 더합니다.
            </p>
            <div className="form-row">
              <label className="label" htmlFor="po-tech">시공자<span className="req">*</span></label>
              <select id="po-tech" name="technician_id" required className="field">
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {RATE_TYPE[t.rate_type] ?? t.rate_type}
                  </option>
                ))}
              </select>
              {techs.length === 0 && <p className="text-xs text-danger mt-1">활동 중인 시공자가 없습니다.</p>}
            </div>
            <div className="grid grid-cols-2 gap-x-2">
              <div className="form-row">
                <label className="label" htmlFor="po-from">시작<span className="req">*</span></label>
                <input id="po-from" name="from" type="date" required defaultValue={lastFrom} className="field mono" />
              </div>
              <div className="form-row">
                <label className="label" htmlFor="po-to">끝<span className="req">*</span></label>
                <input id="po-to" name="to" type="date" required defaultValue={lastTo} className="field mono" />
              </div>
            </div>
            <SubmitButton>만들기</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
