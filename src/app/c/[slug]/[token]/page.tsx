import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedUrlMap, STAR } from "@/lib/public";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { submitCustomerReview } from "@/lib/actions/public";
import { won } from "@/lib/format";
import { mmdd, weekday } from "@/lib/dates";
import { JOB_STATUS, TIME_SLOT } from "@/lib/contracts";

type Page = {
  tenant: { name: string; slug: string; brand: { app_name?: string | null; phone?: string | null } };
  contract: { id: string; contract_no: string; contract_date: string; status: string; approval_status: string; canceled_at: string | null; customer_name: string | null; customer_phone_tail: string | null; site_name: string | null; site_unit: string | null; site_address: string | null; branch_name: string | null; sale_total: number; paid_total: number; balance: number };
  lines: { name: string; work_area_code: string | null; qty: number; amount: number }[];
  jobs: { id: string; work_area: string | null; kind: string; status: string; scheduled_date: string | null; time_slot: string; technician: string | null; started_at: string | null; completed_at: string | null }[];
  photos: { path: string; kind: string; job_id: string | null; taken_at: string }[];
  payments: { entry_type: string; amount: number; occurred_at: string }[];
  review: { rating: number; body: string | null; created_at: string; response: string | null; consent_marketing: boolean } | null;
};

const PAY_LABEL: Record<string, string> = { deposit: "계약금", interim: "중도금", balance: "잔금", refund: "환불" };
const KIND_LABEL: Record<string, string> = { install: "시공", as: "AS", repair: "하자보수" };

export const metadata = { title: "내 시공 일정" };

export default async function CustomerContractPage({ params }: PageProps<"/c/[slug]/[token]">) {
  const { slug, token } = await params;
  const admin = createAdminClient();
  if (!admin) notFound();
  const { data } = await admin.rpc("customer_page", { p_slug: slug, p_token: token });
  if (!data) notFound();
  const d = data as Page;
  const c = d.contract;
  const name = d.tenant.brand.app_name || d.tenant.name;
  const photoUrls = await signedUrlMap(admin, d.photos.map((p) => p.path));
  const jobsDone = d.jobs.filter((j) => j.status === "done").length;
  const allDone = d.jobs.length > 0 && jobsDone === d.jobs.length;
  const headline = c.canceled_at ? "취소된 계약입니다" : allDone ? "시공이 모두 끝났습니다" : d.jobs.some((j) => j.status === "in_progress") ? "지금 시공 중입니다" : "시공 일정을 확인해 주세요";

  return (
    <>
      <section className="card p-5">
        <p className="text-xs text-muted">{c.customer_name} 고객님 · 계약번호 <span className="mono">{c.contract_no}</span></p>
        <h1 className="text-xl font-bold mt-1">{headline}</h1>
        <p className="text-sm text-muted mt-1">{[c.site_name, c.site_unit].filter(Boolean).join(" ")}{c.site_address ? ` · ${c.site_address}` : ""}</p>
        {d.tenant.brand.phone && <a href={`tel:${d.tenant.brand.phone.replace(/\D/g, "")}`} className="btn btn-primary mt-4">일정 변경·문의 전화</a>}
      </section>

      <section className="card">
        <div className="panel-head"><h2>시공 일정 <span className="sub">{jobsDone}/{d.jobs.length} 완료</span></h2></div>
        <ul className="divide-y divide-border">
          {d.jobs.map((j) => {
            const st = JOB_STATUS[j.status] ?? { label: j.status, badge: "wait" as const };
            return (
              <li key={j.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <div className="w-[64px] text-center shrink-0">
                  {j.scheduled_date ? <><div className="text-lg font-bold leading-none">{mmdd(j.scheduled_date)}</div><div className="text-[11px] text-muted mt-0.5">{weekday(j.scheduled_date)}요일 {TIME_SLOT[j.time_slot] ?? ""}</div></> : <div className="text-xs text-muted">일정 협의 중</div>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{j.work_area ?? "시공"} {KIND_LABEL[j.kind] ?? j.kind}</div>
                  <div className="text-xs text-muted">{j.technician ? `담당 기사 ${j.technician}` : "기사 배정 예정"}</div>
                </div>
                <span className={`badge badge-${st.badge}`}>{st.label}</span>
              </li>
            );
          })}
          {d.jobs.length === 0 && <li className="px-4 py-3 text-sm text-muted">아직 잡힌 시공 일정이 없습니다. 곧 연락드리겠습니다.</li>}
        </ul>
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold mb-2">계약 내용</h2>
        <table className="tbl">
          <tbody>
            {d.lines.map((l, i) => <tr key={i}><td>{l.name}{l.qty !== 1 && <span className="text-muted text-xs"> × {l.qty}</span>}</td><td className="num text-right">{won(l.amount)}원</td></tr>)}
          </tbody>
          <tfoot>
            <tr><td>총 금액</td><td className="num text-right">{won(c.sale_total)}원</td></tr>
            <tr><td>입금 확인</td><td className="num text-right">{won(c.paid_total)}원</td></tr>
            <tr><td className="font-semibold">{c.balance > 0 ? "남은 금액" : "잔액"}</td><td className={`num text-right font-semibold ${c.balance > 0 ? "text-danger" : ""}`}>{won(c.balance)}원</td></tr>
          </tfoot>
        </table>
        {d.payments.length > 0 && (
          <ul className="text-xs text-muted mt-2 grid gap-0.5">
            {d.payments.map((p, i) => <li key={i}>{mmdd(p.occurred_at.slice(0, 10))} {PAY_LABEL[p.entry_type] ?? p.entry_type} {won(p.amount)}원</li>)}
          </ul>
        )}
      </section>

      {d.photos.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold mb-3">시공 사진</h2>
          <div className="grid grid-cols-3 gap-1.5">
            {d.photos.map((p) => {
              const u = photoUrls.get(p.path);
              return u ? (
                <figure key={p.path} className="m-0 aspect-square overflow-hidden rounded bg-bg relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" loading="lazy" className="w-full h-full object-cover" />
                  <figcaption className="absolute left-1 bottom-1 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">{p.kind === "before" ? "시공 전" : p.kind === "after" ? "시공 후" : "과정"}</figcaption>
                </figure>
              ) : null;
            })}
          </div>
        </section>
      )}

      <section className="card p-4">
        <h2 className="text-sm font-semibold mb-1">{d.review ? "남겨 주신 후기" : "후기 남기기"}</h2>
        {d.review && (
          <div className="text-sm mb-3">
            <div className="text-warn">{STAR(d.review.rating)}</div>
            <p className="whitespace-pre-wrap mt-1">{d.review.body}</p>
            {d.review.response && <p className="mt-2 text-xs text-muted border-l-2 border-border pl-2"><b>{name}</b> {d.review.response}</p>}
          </div>
        )}
        <details open={!d.review}>
          <summary className="text-xs text-accent cursor-pointer">{d.review ? "후기 고치기" : "시공은 어떠셨나요?"}</summary>
          <ActionForm action={submitCustomerReview} className="mt-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="token" value={token} />
            <div className="form-row">
              <span className="label">별점</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name="rating" value={n} defaultChecked={(d.review?.rating ?? 5) === n} className="sr-only peer" required />
                    <span className="block px-2.5 py-1.5 rounded border border-border text-sm peer-checked:bg-accent peer-checked:text-white peer-checked:border-accent">{n}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="form-row"><label className="label" htmlFor="body">후기</label><textarea id="body" name="body" rows={4} minLength={5} maxLength={2000} required defaultValue={d.review?.body ?? ""} className="field" placeholder="시공 결과, 기사님 응대 등 느끼신 대로 적어 주세요" /></div>
            <div className="form-row"><label className="label" htmlFor="author">표시 이름 (선택)</label><input id="author" name="author" maxLength={40} className="field" placeholder="예: 김○○" /></div>
            <label className="flex items-start gap-2 text-xs text-muted mb-3"><input type="checkbox" name="consent" defaultChecked={d.review?.consent_marketing ?? false} className="mt-0.5" /> 이 후기와 시공 사진을 {name} 홍보(홈페이지·SNS)에 써도 좋습니다. 이름은 가려서 표시됩니다.</label>
            <SubmitButton className="btn btn-primary">후기 남기기</SubmitButton>
          </ActionForm>
        </details>
      </section>
    </>
  );
}
