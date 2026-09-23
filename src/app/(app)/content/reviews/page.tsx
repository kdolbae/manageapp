import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/inbox";
import { REVIEW_CHANNEL, REVIEW_STATUS, stars } from "@/lib/media";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createReview, updateReview } from "@/lib/actions/media";

export const metadata = { title: "후기" };

type Review = {
  id: string;
  contract_id: string | null;
  customer_id: string | null;
  channel: string;
  rating: number | null;
  body: string | null;
  author_name: string | null;
  source_url: string | null;
  consent_marketing: boolean;
  status: string;
  response: string | null;
  responded_at: string | null;
  created_at: string;
  contract: { contract_no: string } | null;
  customer: { name: string } | null;
};
type ContractOption = { id: string; contract_no: string; customer_name: string | null };

const clip = (s: string | null, n = 60) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");

export default async function ReviewsPage({ searchParams }: PageProps<"/content/reviews">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && Object.hasOwn(REVIEW_STATUS, sp.status) ? sp.status : "";
  const canWrite = session.can("content.write");
  const canPublish = session.can("content.publish");
  const supabase = await createClient();

  let query = supabase
    .from("review")
    .select("id, contract_id, customer_id, channel, rating, body, author_name, source_url, consent_marketing, status, response, responded_at, created_at, contract:contract(contract_no), customer:customer(name)")
    .eq("tenant_id", tid)
    .is("deleted_at", null);
  if (status) query = query.eq("status", status);
  const [{ data: reviews }, { data: contracts }] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(200),
    canWrite
      ? supabase.from("contract_summary").select("id, contract_no, customer_name").eq("tenant_id", tid).order("contract_date", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as ContractOption[] }),
  ]);
  const list = (reviews ?? []) as unknown as Review[];
  const contractList = (contracts ?? []) as ContractOption[];
  const cols = canWrite ? 9 : 8;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="grid gap-3 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href="/content/reviews" className={`chip ${!status ? "is-active" : ""}`}>전체</Link>
          {Object.entries(REVIEW_STATUS).map(([k, v]) => (
            <Link key={k} href={`/content/reviews?status=${k}`} className={`chip ${status === k ? "is-active" : ""}`}>{v.label}</Link>
          ))}
        </div>
        <p className="text-xs text-muted">고객이 직접 쓰는 후기는 고객 페이지(D10)에서 들어옵니다. 지금은 카카오·네이버 등에 남은 후기를 옮겨 적고, 승인한 후기만 콘텐츠에 붙습니다.</p>
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>날짜</th><th>작성자 · 고객</th><th>별점</th><th>내용</th><th>채널</th><th>마케팅 동의</th><th>상태</th><th>답글</th>{canWrite && <th></th>}</tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const st = REVIEW_STATUS[r.status] ?? { label: r.status, badge: "wait" as const };
                return (
                  <tr key={r.id}>
                    <td className="mono text-xs text-muted whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td>
                      <div className="font-semibold">{r.author_name ?? r.customer?.name ?? "—"}</div>
                      <div className="text-xs text-muted">
                        {r.contract && <Link href={`/contracts/${r.contract_id}`} className="mono">{r.contract.contract_no}</Link>}
                        {r.contract && r.customer?.name && r.author_name ? ` · ${r.customer.name}` : r.customer?.name && r.author_name ? r.customer.name : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-warn">{stars(r.rating)}</td>
                    <td className="max-w-[320px]">
                      <div className="truncate" title={r.body ?? ""}>{clip(r.body)}</div>
                      {r.source_url && <a href={r.source_url} target="_blank" rel="noreferrer" className="text-xs">원문 보기</a>}
                    </td>
                    <td className="whitespace-nowrap">{REVIEW_CHANNEL[r.channel] ?? r.channel}</td>
                    <td><span className={`badge ${r.consent_marketing ? "badge-done" : "badge-wait"}`}>{r.consent_marketing ? "동의" : "미동의"}</span></td>
                    <td><span className={`badge badge-${st.badge}`}>{st.label}</span></td>
                    <td className="max-w-[200px] text-xs text-muted"><div className="truncate" title={r.response ?? ""}>{clip(r.response, 40) || "—"}</div></td>
                    {canWrite && (
                      <td>
                        <details>
                          <summary className="cursor-pointer text-accent text-xs whitespace-nowrap">처리</summary>
                          <ActionForm action={updateReview} className="mt-2 grid gap-2 min-w-[240px]">
                            <input type="hidden" name="id" value={r.id} />
                            <select name="status" defaultValue={r.status} className="field" aria-label="상태">
                              <option value="pending">대기</option>
                              {(canPublish || r.status === "approved") && <option value="approved">{canPublish ? "승인 (콘텐츠에 쓸 수 있음)" : "승인 (유지)"}</option>}
                              <option value="hidden">숨김</option>
                            </select>
                            <textarea name="response" defaultValue={r.response ?? ""} placeholder="사업체 답글" className="field" rows={3} maxLength={2000} aria-label="답글" />
                            <label className="flex items-center gap-2 text-xs">
                              <input type="hidden" name="set_consent" value="1" />
                              <input type="checkbox" name="consent_marketing" defaultChecked={r.consent_marketing} className="w-4 h-4" />
                              마케팅 사용 동의 받음
                            </label>
                            <SubmitButton className="btn btn-sm">저장</SubmitButton>
                          </ActionForm>
                          {!canPublish && r.status !== "approved" && <p className="text-[11px] text-muted mt-1">승인은 발행 권한이 있는 사람이 합니다.</p>}
                          {r.status === "approved" && <Link href={`/content/posts/new?review=${r.id}`} className="btn btn-sm mt-2">이 후기로 콘텐츠 만들기</Link>}
                        </details>
                      </td>
                    )}
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={cols} className="text-muted">후기가 없습니다.</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={cols}>{list.length}건{list.length >= 200 ? " (최근 200건만)" : ""}</td></tr></tfoot>
          </table>
        </div>
      </div>

      {canWrite && (
        <section className="card">
          <div className="panel-head"><h2>후기 직접 입력</h2></div>
          <ActionForm action={createReview} className="p-4">
            <div className="form-row">
              <label className="label">계약</label>
              <select name="contract_id" className="field" defaultValue="">
                <option value="">연결 안 함</option>
                {contractList.map((c) => <option key={c.id} value={c.id}>{c.contract_no} · {c.customer_name ?? "고객"}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label className="label">별점<span className="req">*</span></label>
              <select name="rating" className="field" defaultValue="5">
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{stars(n)} {n}점</option>)}
              </select>
            </div>
            <div className="form-row"><label className="label">작성자 표시 이름</label><input name="author_name" className="field" maxLength={60} placeholder="예: 김○○" /></div>
            <div className="form-row"><label className="label">내용<span className="req">*</span></label><textarea name="body" className="field" rows={5} required maxLength={4000} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="form-row">
                <label className="label">채널</label>
                <select name="channel" className="field" defaultValue="manual">
                  {Object.entries(REVIEW_CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="form-row"><label className="label">원문 주소</label><input name="source_url" type="url" className="field mono" placeholder="https://" maxLength={500} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" name="consent_marketing" className="w-4 h-4" />
              고객이 후기·사진의 마케팅 사용에 동의함
            </label>
            <SubmitButton>후기 등록</SubmitButton>
            <p className="text-xs text-muted mt-3">등록 직후 상태는 대기입니다. 발행 권한자가 승인하면 콘텐츠에 붙일 수 있습니다.</p>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
