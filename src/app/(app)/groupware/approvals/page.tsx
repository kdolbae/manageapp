import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { APPROVAL_KIND, APPROVAL_STATUS, ymdKST } from "@/lib/groupware";
import { myPendingDocIds } from "../data";

export const metadata = { title: "결재" };

type Doc = {
  id: string;
  doc_no: string | null;
  kind: string;
  title: string;
  amount: number | null;
  status: string;
  current_step: number;
  submitted_at: string | null;
  created_at: string;
  requester_id: string;
  requester: { display_name: string } | null;
};
type Step = { doc_id: string; step_no: number; status: string; approver: { display_name: string } | null };

function currentStep(doc: Doc, steps: Step[]) {
  const mine = steps.filter((s) => s.doc_id === doc.id);
  if (doc.status === "submitted") {
    const p = mine.find((s) => s.status === "pending");
    return p ? `${p.step_no}/${mine.length} ${p.approver?.display_name ?? ""}` : "—";
  }
  if (doc.status === "approved") return `완료 (${mine.length}단계)`;
  if (doc.status === "rejected") {
    const r = mine.find((s) => s.status === "rejected");
    return r ? `${r.step_no}단계 ${r.approver?.display_name ?? ""} 반려` : "반려";
  }
  if (doc.status === "draft") return mine.length ? `결재선 ${mine.length}명` : "결재선 없음";
  return "—";
}

export default async function ApprovalsPage({ searchParams }: PageProps<"/groupware/approvals">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const me = session.user.id;
  const sp = await searchParams;
  const canDecide = session.can("approval.decide");
  const canWrite = session.can("approval.write");
  const chips = [
    { key: "todo", label: "내 결재 차례" },
    { key: "mine", label: "내가 올린" },
    ...(canDecide ? [{ key: "all", label: "전체" }] : []),
  ];
  const requested = typeof sp.f === "string" ? sp.f : "";
  const filter = chips.some((c) => c.key === requested) ? requested : canDecide ? "todo" : "mine";
  const supabase = await createClient();

  const todoIds = await myPendingDocIds(supabase, tid, me);
  let query = supabase
    .from("approval_doc")
    .select("id, doc_no, kind, title, amount, status, current_step, submitted_at, created_at, requester_id, requester:profile(display_name)")
    .eq("tenant_id", tid)
    .is("deleted_at", null);
  if (filter === "mine") query = query.eq("requester_id", me);
  if (filter === "todo") query = query.in("id", todoIds);
  const { data: rows } = filter === "todo" && todoIds.length === 0 ? { data: [] as Doc[] } : await query.order("created_at", { ascending: false }).limit(200);
  const docs = (rows ?? []) as unknown as Doc[];
  const ids = docs.map((d) => d.id);
  const { data: stepRows } = ids.length
    ? await supabase.from("approval_step").select("doc_id, step_no, status, approver:profile(display_name)").in("doc_id", ids).order("step_no")
    : { data: [] as Step[] };
  const steps = (stepRows ?? []) as unknown as Step[];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        {chips.map((c) => (
          <Link key={c.key} href={`/groupware/approvals?f=${c.key}`} className={`chip ${filter === c.key ? "is-active" : ""}`}>
            {c.label}
            {c.key === "todo" && todoIds.length > 0 && <span className="mono text-[11px]">{todoIds.length}</span>}
          </Link>
        ))}
        {canWrite && (
          <Link href="/groupware/approvals/new" className="btn btn-primary btn-sm ml-auto">결재 올리기</Link>
        )}
      </div>
      <div className={"grid gap-4 p-4 items-start" + (canWrite ? " lg:grid-cols-[1fr_340px]" : "")}>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>번호</th>
                <th>종류</th>
                <th>제목</th>
                <th className="text-right">금액</th>
                <th>상신자</th>
                <th>현재 단계</th>
                <th>상태</th>
                <th>상신일</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const st = APPROVAL_STATUS[d.status] ?? { label: d.status, badge: "wait" as const };
                const isTodo = todoIds.includes(d.id);
                return (
                  <tr key={d.id} className={isTodo ? "is-selected" : ""}>
                    <td className="mono text-xs whitespace-nowrap"><Link href={`/groupware/approvals/${d.id}`}>{d.doc_no ?? "—"}</Link></td>
                    <td className="text-xs">{APPROVAL_KIND[d.kind] ?? d.kind}</td>
                    <td><Link href={`/groupware/approvals/${d.id}`} className="font-semibold text-text no-underline">{d.title}</Link></td>
                    <td className={`num ${d.amount ? "" : "zero"}`}>{d.amount ? won(d.amount) : "—"}</td>
                    <td className="text-xs">{d.requester?.display_name ?? "—"}{d.requester_id === me && <span className="text-muted"> (나)</span>}</td>
                    <td className="text-xs">{currentStep(d, steps)}</td>
                    <td><span className={`badge badge-${isTodo ? "risk" : st.badge}`}>{isTodo ? "내 차례" : st.label}</span></td>
                    <td className="mono text-xs text-muted whitespace-nowrap">{d.submitted_at ? ymdKST(d.submitted_at) : <span className="zero">{ymdKST(d.created_at)} 작성</span>}</td>
                  </tr>
                );
              })}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted">
                    {filter === "todo" ? "지금 내 차례인 결재가 없습니다." : filter === "mine" ? "올린 결재가 없습니다." : "결재 문서가 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8}>{docs.length}건</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {canWrite && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-1">결재 올리기</h2>
            <p className="text-xs text-muted mb-3">구매·지출·휴가·계약 취소·할인 등을 결재선(최대 3단계)에 올립니다. 각 단계 결재자에게 앱 알림이 가고, 마지막 단계가 승인하면 문서가 승인됩니다.</p>
            <Link href="/groupware/approvals/new" className="btn btn-primary w-full">결재 올리기</Link>
          </div>
        )}
      </div>
    </div>
  );
}
