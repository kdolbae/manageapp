import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { todayKST } from "@/lib/dates";
import { fmtDateTime } from "@/lib/inbox";
import { APPLICATION_STATUS, REQUEST_STATUS, categoryLabels, platformCategories } from "@/lib/market";
import { StatusBadge, EmptyRow } from "./shared";
import { APPLICATION_SELECT, REQUEST_SELECT, platformVendors, quotesFor, statusCounts, type Application, type ServiceRequest, vendorNameMap, vendorName } from "./data";

export const metadata = { title: "플랫폼 운영 현황" };

type SettlementBrief = { status: string; total: number };
type QuoteBrief = { status: string };

export default async function PlatformHome() {
  await requireTenant();
  const supabase = await createClient();
  const monthFrom = `${todayKST().slice(0, 7)}-01T00:00:00+09:00`;
  const [appCounts, vendors, reqCounts, { data: qRows }, { data: sRows }, promoCounts, { data: rRows }, { data: aRows }, cats] = await Promise.all([
    statusCounts(supabase, "vendor_application", ["pending"]),
    platformVendors(supabase),
    statusCounts(supabase, "service_request", ["open", "accepted"]),
    supabase.from("quote").select("status").gte("created_at", monthFrom),
    supabase.from("platform_settlement").select("status, total").in("status", ["draft", "issued"]),
    statusCounts(supabase, "vendor_promotion", ["requested"]),
    supabase.from("service_request").select(REQUEST_SELECT).order("created_at", { ascending: false }).limit(5),
    supabase.from("vendor_application").select(APPLICATION_SELECT).order("created_at", { ascending: false }).limit(5),
    platformCategories(supabase, false),
  ]);
  const quotes = (qRows ?? []) as QuoteBrief[];
  const settlements = (sRows ?? []) as SettlementBrief[];
  const recent = (rRows ?? []) as ServiceRequest[];
  const apps = (aRows ?? []) as Application[];
  const recentQuotes = await quotesFor(supabase, recent.map((r) => r.id));
  const names = vendorNameMap(vendors);

  const listed = vendors.filter((v) => v.is_listed).length;
  const acceptedThisMonth = quotes.filter((q) => q.status === "accepted").length;
  const drafts = settlements.filter((s) => s.status === "draft").length;
  const issued = settlements.filter((s) => s.status === "issued");
  const unpaid = issued.reduce((sum, s) => sum + Number(s.total ?? 0), 0);
  const zero = (n: number) => (n ? "" : "zero");

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border-b border-border bg-surface">
        <Link href="/platform/applications" className="stat no-underline text-text">
          <div className="k">심사 대기 신청</div>
          <div className={`v ${appCounts.pending ? "text-danger" : "zero"}`}>{appCounts.pending}</div>
        </Link>
        <Link href="/platform/vendors" className="stat no-underline text-text">
          <div className="k">노출 업체 / 전체</div>
          <div className={`v ${zero(vendors.length)}`}>
            {listed}
            <span className="text-xs text-muted font-normal ml-1">/ {vendors.length}곳</span>
          </div>
        </Link>
        <Link href="/platform/requests?s=open" className="stat no-underline text-text">
          <div className="k">열린 요청</div>
          <div className={`v ${zero(reqCounts.open)}`}>
            {reqCounts.open}
            <span className="text-xs text-muted font-normal ml-1">· 업체 선택됨 {reqCounts.accepted}</span>
          </div>
        </Link>
        <Link href="/platform/requests" className="stat no-underline text-text">
          <div className="k">이번 달 견적 / 선택</div>
          <div className={`v ${zero(quotes.length)}`}>
            {quotes.length}
            <span className="text-xs text-muted font-normal ml-1">/ {acceptedThisMonth}건</span>
          </div>
        </Link>
        <Link href="/platform/settlements" className="stat no-underline text-text">
          <div className="k">정산서 작성 중 · 발행</div>
          <div className={`v ${zero(settlements.length)}`}>
            {drafts}
            <span className="text-xs text-muted font-normal mx-1">·</span>
            {issued.length}
            <span className="text-xs text-muted font-normal ml-1">미입금 {won(unpaid)}원</span>
          </div>
        </Link>
        <Link href="/platform/promotions" className="stat no-underline text-text">
          <div className="k">광고 신청 대기</div>
          <div className={`v ${promoCounts.requested ? "text-warn" : "zero"}`}>{promoCounts.requested}</div>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pt-4">
        <Link href="/platform/applications" className="btn btn-sm">신청 심사</Link>
        <Link href="/platform/vendors" className="btn btn-sm">업체·수수료</Link>
        <Link href="/platform/requests" className="btn btn-sm">요청·견적</Link>
        <Link href="/platform/settlements" className="btn btn-sm">정산서 만들기</Link>
        <Link href="/platform/promotions" className="btn btn-sm">광고 승인</Link>
        <Link href="/platform/categories" className="btn btn-sm">서비스 분류</Link>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2 items-start">
        <div className="card overflow-x-auto">
          <div className="panel-head">
            <h2>
              최근 요청 <span className="sub">5건</span>
            </h2>
            <Link href="/platform/requests" className="text-xs">전체 보기</Link>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>접수</th>
                <th>지역 · 단지</th>
                <th>분류</th>
                <th className="text-right">견적</th>
                <th>선택 업체</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const qs = recentQuotes.filter((q) => q.request_id === r.id);
                const accepted = qs.find((q) => q.status === "accepted");
                return (
                  <tr key={r.id}>
                    <td className="mono text-xs text-muted whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td>
                      <Link href={`/platform/requests/${r.id}`} className="font-semibold text-text no-underline">
                        {r.region}
                        {r.apt ? ` · ${r.apt}` : ""}
                      </Link>
                    </td>
                    <td className="text-xs">{categoryLabels(r.categories, cats) || "—"}</td>
                    <td className={`num ${zero(qs.length)}`}>{qs.length}</td>
                    <td className="text-xs">{accepted ? vendorName(names, accepted.tenant_id) : <span className="text-muted">—</span>}</td>
                    <td><StatusBadge s={REQUEST_STATUS[r.status]} fallback={r.status} /></td>
                  </tr>
                );
              })}
              {recent.length === 0 && <EmptyRow cols={6}>아직 고객 요청이 없습니다.</EmptyRow>}
            </tbody>
          </table>
        </div>

        <div className="card overflow-x-auto">
          <div className="panel-head">
            <h2>
              최근 신청 <span className="sub">5건</span>
            </h2>
            <Link href="/platform/applications?s=all" className="text-xs">전체 보기</Link>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>접수</th>
                <th>상호</th>
                <th>지역</th>
                <th>분류</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td className="mono text-xs text-muted whitespace-nowrap">{fmtDateTime(a.created_at)}</td>
                  <td>
                    <Link href={`/platform/applications?s=${a.status}`} className="font-semibold text-text no-underline">{a.name}</Link>
                  </td>
                  <td className="text-xs">{a.regions.join(" · ") || "—"}</td>
                  <td className="text-xs">{categoryLabels(a.categories, cats) || "—"}</td>
                  <td><StatusBadge s={APPLICATION_STATUS[a.status]} fallback={a.status} /></td>
                </tr>
              ))}
              {apps.length === 0 && <EmptyRow cols={5}>아직 협력업체 신청이 없습니다.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
