import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, mmdd, todayKST } from "@/lib/dates";
import { monthEnd, monthStart } from "@/lib/stats";
import { clampPeriod } from "@/lib/online/period";
import { buildReport, shapeReport } from "@/lib/online/report";
import { OnlineBoard } from "./board";

export const metadata = { title: "온라인 성과" };
export const dynamic = "force-dynamic";

export default async function OnlinePage({ searchParams }: PageProps<"/sales/online">) {
  const session = await requireTenant();
  if (!session.can("conversion.read")) return <p className="p-4 text-sm text-muted">온라인 성과 조회 권한이 없습니다.</p>;
  const sp = await searchParams;
  const { from, to, clipped } = clampPeriod(sp.from, sp.to);
  const supabase = await createClient();
  const tid = session.current.tenant_id;
  const data = shapeReport(await buildReport(supabase, tid, from, to), session.can("conversion.labels"));

  const today = todayKST();
  const lastMonthEnd = addDays(monthStart(today), -1);
  const periods = [
    { label: "오늘", from: today, to: today },
    { label: "어제", from: addDays(today, -1), to: addDays(today, -1) },
    { label: "7일", from: addDays(today, -6), to: today },
    { label: "30일", from: addDays(today, -29), to: today },
    { label: "이번 달", from: monthStart(today), to: today },
    { label: "지난 달", from: monthStart(lastMonthEnd), to: monthEnd(lastMonthEnd) },
    { label: "90일", from: addDays(today, -89), to: today },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        <span className="text-xs text-muted mr-1">{mmdd(from)} ~ {mmdd(to)}</span>
        {periods.map((p) => (
          <Link key={p.label} href={`/sales/online?from=${p.from}&to=${p.to}`} className={`chip ${from === p.from && to === p.to ? "is-active" : ""}`}>{p.label}</Link>
        ))}
        <form method="get" className="flex items-center gap-1.5 ml-auto">
          <input type="date" name="from" defaultValue={from} className="field h-8 text-xs w-[140px]" aria-label="시작일" />
          <span className="text-xs text-muted">~</span>
          <input type="date" name="to" defaultValue={to} className="field h-8 text-xs w-[140px]" aria-label="끝일" />
          <button className="btn btn-sm">보기</button>
        </form>
      </div>
      {clipped && <p className="notice mx-4 mt-3">기간은 최대 366일입니다. {from} 부터로 잘랐습니다.</p>}
      <OnlineBoard key={`${from}~${to}`} initial={data} canWrite={session.can("conversion.write")} canLinkContract={session.can("contract.read")} />
    </div>
  );
}
