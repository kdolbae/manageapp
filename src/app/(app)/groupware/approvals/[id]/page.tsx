import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { won } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { cancelApproval, decideStep, submitApproval, updateApproval } from "@/lib/actions/groupware";
import { APPROVAL_KIND, APPROVAL_STATUS, STEP_STATUS } from "@/lib/groupware";
import { fmtDateTime } from "@/lib/inbox";
import { memberOptions } from "@/app/(app)/people/data";
import { UUID } from "../../data";
import { FormButton } from "../../ui";
import { ApprovalFields } from "../approval-fields";

export const metadata = { title: "결재 문서" };

type Doc = {
  id: string;
  doc_no: string | null;
  kind: string;
  title: string;
  body: string | null;
  amount: number | null;
  branch_id: string | null;
  requester_id: string;
  status: string;
  current_step: number;
  submitted_at: string | null;
  decided_at: string | null;
  created_at: string;
  requester: { display_name: string } | null;
  branch: { name: string } | null;
};
type Step = { id: string; step_no: number; approver_id: string; status: string; comment: string | null; decided_at: string | null; approver: { display_name: string } | null };

export default async function ApprovalPage({ params }: PageProps<"/groupware/approvals/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const me = session.user.id;
  const supabase = await createClient();

  const { data } = await supabase
    .from("approval_doc")
    .select("id, doc_no, kind, title, body, amount, branch_id, requester_id, status, current_step, submitted_at, decided_at, created_at, requester:profile(display_name), branch:branch(name)")
    .eq("id", id)
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  const doc = data as unknown as Doc;
  const isRequester = doc.requester_id === me;
  const isOwner = session.current.role.code === "owner";
  const draft = doc.status === "draft";

  const [{ data: stepRows }, members] = await Promise.all([
    supabase.from("approval_step").select("id, step_no, approver_id, status, comment, decided_at, approver:profile(display_name)").eq("doc_id", id).order("step_no"),
    isRequester && draft ? memberOptions(supabase, tid) : [],
  ]);
  const steps = (stepRows ?? []) as unknown as Step[];
  const pending = steps.find((s) => s.status === "pending") ?? null;
  const myTurn = doc.status === "submitted" && pending !== null && (pending.approver_id === me || isOwner);
  const st = APPROVAL_STATUS[doc.status] ?? { label: doc.status, badge: "wait" as const };
  const approverOptions = members.filter((m) => m.id !== me);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="grid gap-4">
        <div className="card p-4">
          <div className="text-xs text-muted mb-3">
            <Link href="/groupware/approvals">결재</Link>
            <span className="mx-1.5">/</span>
            <span className="mono text-text font-medium">{doc.doc_no ?? "번호 없음"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="text-lg font-semibold">{doc.title}</h2>
            <span className="badge badge-wait">{APPROVAL_KIND[doc.kind] ?? doc.kind}</span>
            <span className={`badge badge-${st.badge}`}>{st.label}</span>
            {myTurn && <span className="badge badge-risk">내 결재 차례</span>}
          </div>
          <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 gap-x-3 text-sm mb-4">
            <dt className="text-muted">상신자</dt>
            <dd>{doc.requester?.display_name ?? "—"}{isRequester && <span className="text-muted text-xs"> (나)</span>}{doc.branch && <span className="text-muted text-xs"> · {doc.branch.name}</span>}</dd>
            <dt className="text-muted">금액</dt>
            <dd className="mono">{doc.amount ? `${won(doc.amount)}원` : <span className="text-muted">—</span>}</dd>
            <dt className="text-muted">작성</dt>
            <dd className="mono text-xs">{fmtDateTime(doc.created_at)}</dd>
            {doc.submitted_at && (
              <>
                <dt className="text-muted">상신</dt>
                <dd className="mono text-xs">{fmtDateTime(doc.submitted_at)}</dd>
              </>
            )}
            {doc.decided_at && (
              <>
                <dt className="text-muted">{st.label} 시각</dt>
                <dd className="mono text-xs">{fmtDateTime(doc.decided_at)}</dd>
              </>
            )}
          </dl>
          <h3 className="text-xs font-semibold text-muted mb-1.5">내용</h3>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{doc.body || <span className="text-muted">내용 없음</span>}</p>
        </div>

        <div className="card">
          <div className="panel-head">
            <h2>
              결재선 <span className="sub">{steps.length}단계</span>
            </h2>
          </div>
          <ol className="divide-y divide-border">
            {steps.map((s) => {
              // 상신자가 취소하면 단계는 pending/waiting 으로 남으므로 취소로 보여준다
              const ss =
                doc.status === "canceled" && (s.status === "pending" || s.status === "waiting")
                  ? { label: "취소", badge: "wait" as const }
                  : (STEP_STATUS[s.status] ?? { label: s.status, badge: "wait" as const });
              return (
                <li key={s.id} className="flex gap-3 px-4 py-3 text-sm">
                  <span className={"mono w-7 h-7 shrink-0 rounded-full border flex items-center justify-center text-xs " + (ss.badge === "run" ? "border-accent text-accent font-bold" : ss.badge === "done" ? "border-success text-success" : ss.badge === "risk" ? "border-danger text-danger" : "border-border text-muted")}>{s.step_no}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.approver?.display_name ?? "(구성원)"}</span>
                      {s.approver_id === me && <span className="text-xs text-muted">(나)</span>}
                      <span className={`badge badge-${ss.badge}`}>{ss.label}</span>
                      {s.decided_at && <span className="mono text-xs text-muted">{fmtDateTime(s.decided_at)}</span>}
                    </div>
                    {s.comment && <p className="text-xs mt-1 whitespace-pre-wrap">{s.comment}</p>}
                  </div>
                </li>
              );
            })}
            {steps.length === 0 && <li className="px-4 py-3 text-sm text-muted">결재선이 없습니다. {isRequester && draft ? "아래에서 결재자를 정한 뒤 상신해 주세요." : ""}</li>}
          </ol>
        </div>

        {isRequester && draft && (
          <div className="card p-4">
            <details open>
              <summary className="cursor-pointer text-sm font-semibold">내용·결재선 수정</summary>
              <ActionForm action={updateApproval} className="mt-3">
                <input type="hidden" name="id" value={doc.id} />
                <ApprovalFields values={{ kind: doc.kind, title: doc.title, body: doc.body, amount: doc.amount, approvers: steps.map((s) => s.approver_id) }} members={approverOptions} idPrefix="ap-edit" />
                <div className="flex flex-wrap gap-2 mt-1">
                  <FormButton name="mode" value="draft" className="btn">저장</FormButton>
                  <FormButton name="mode" value="submit" className="btn btn-primary">저장하고 상신</FormButton>
                </div>
              </ActionForm>
            </details>
          </div>
        )}
      </div>

      <div className="grid gap-4">
        {myTurn && pending && (
          session.can("approval.decide") ? (
            <ActionForm action={decideStep} className="card p-4">
              <input type="hidden" name="id" value={pending.id} />
              <input type="hidden" name="doc_id" value={doc.id} />
              <h2 className="text-sm font-semibold mb-1">{pending.step_no}단계 결재</h2>
              <p className="text-xs text-muted mb-3">{pending.approver_id === me ? "내 차례입니다." : "대표 권한으로 대신 결재합니다."} 승인하면 다음 단계로 넘어가고, 반려하면 문서가 반려됩니다.</p>
              <div className="form-row">
                <label className="label" htmlFor="decide-comment">의견</label>
                <textarea id="decide-comment" name="comment" rows={3} maxLength={1000} className="field" placeholder="승인·반려 사유(선택)" />
              </div>
              <div className="flex gap-2">
                <FormButton name="decision" value="approved" className="btn btn-primary">승인</FormButton>
                <FormButton name="decision" value="rejected" className="btn btn-danger">반려</FormButton>
              </div>
            </ActionForm>
          ) : (
            <p className="notice notice-danger">내 결재 차례이지만 결재 승인·반려 권한이 없습니다. 역할·권한 설정을 확인해 주세요.</p>
          )
        )}

        {isRequester && draft && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-1">상신</h2>
            <p className="text-xs text-muted mb-3">결재선 {steps.length}명. 상신하면 1단계 결재자에게 알림이 가고, 내용은 더 고칠 수 없습니다.</p>
            <ActionForm action={submitApproval}>
              <input type="hidden" name="id" value={doc.id} />
              <SubmitButton className="btn btn-primary w-full">상신</SubmitButton>
            </ActionForm>
            <ActionForm action={cancelApproval} className="mt-2">
              <input type="hidden" name="id" value={doc.id} />
              <SubmitButton className="btn btn-danger w-full">작성 취소</SubmitButton>
            </ActionForm>
          </div>
        )}

        {isRequester && doc.status === "submitted" && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-1">결재 진행 중</h2>
            <p className="text-xs text-muted mb-3">{pending ? `${pending.step_no}단계 ${pending.approver?.display_name ?? ""} 결재 대기 중입니다.` : "결재 대기 중입니다."} 취소하면 결재선에서 빠지고 되돌릴 수 없습니다.</p>
            <ActionForm action={cancelApproval}>
              <input type="hidden" name="id" value={doc.id} />
              <SubmitButton className="btn btn-danger w-full">상신 취소</SubmitButton>
            </ActionForm>
          </div>
        )}

        {!myTurn && !isRequester && (
          <div className="card p-4 text-sm text-muted">
            {doc.status === "submitted" && pending ? `${pending.step_no}단계 ${pending.approver?.display_name ?? ""} 결재 대기 중입니다.` : `${st.label} 상태의 문서입니다.`}
          </div>
        )}
        {!myTurn && isRequester && (doc.status === "approved" || doc.status === "rejected" || doc.status === "canceled") && (
          <div className="card p-4 text-sm text-muted">{st.label}된 문서입니다. 다시 올리려면 새 결재를 작성해 주세요.</div>
        )}
        <Link href="/groupware/approvals" className="btn">목록으로</Link>
      </div>
    </div>
  );
}
