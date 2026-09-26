"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";
import { leaveDays } from "@/lib/groupware";

const uuid = z.string().uuid();
const optUuid = z.string().uuid().or(z.literal("")).optional().transform((v) => (v ? v : null));
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = z.string().trim().optional().transform((v) => (v ? v : null)).pipe(ymd.nullable());
const fail = (message: string): ActionState => ({ error: message });

/** RLS·트리거가 막으면(42501) 한국어 안내. 트리거가 이미 한국어로 이유를 말했으면 그 말을 그대로 보여준다. */
function friendly(error: { code?: string; message: string }, denied = "권한이 없습니다.") {
  if (error.code === "42501") return /[가-힣]/.test(error.message) ? error.message : denied;
  return error.message;
}

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

function revalidateGroupware(...paths: string[]) {
  revalidatePath("/groupware", "layout");
  for (const p of paths) revalidatePath(p);
}

// ---------------------------------------------------------------- 공지
const noticeInput = z.object({
  title: z.string().trim().min(1).max(120),
  body: optText(10000),
  branch_id: optUuid,
  pinned: z.enum(["on"]).optional(),
  expires_at: optDate,
});

/** 날짜(YYYY-MM-DD)를 그날 끝(한국 시간)으로 */
const endOfDayKST = (d: string | null) => (d ? `${d}T23:59:59+09:00` : null);

export async function createNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = noticeInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("제목(120자 이내)과 만료일을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("notice.write");
  const { title, body, branch_id, pinned, expires_at } = parsed.data;
  const { error } = await supabase
    .from("notice")
    .insert({ tenant_id: tenantId, title, body, branch_id, pinned: pinned === "on", expires_at: endOfDayKST(expires_at), created_by: session.user.id });
  if (error) return fail(friendly(error, "공지를 올릴 권한이 없습니다. 지점 범위 사용자는 자기 지점으로만 올릴 수 있습니다."));
  revalidateGroupware();
  return { ok: "공지를 올렸습니다." };
}

export async function updateNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = noticeInput.extend({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("제목(120자 이내)과 만료일을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("notice.write");
  const { id, title, body, branch_id, pinned, expires_at } = parsed.data;
  const { error, count } = await supabase
    .from("notice")
    .update({ title, body, branch_id, pinned: pinned === "on", expires_at: endOfDayKST(expires_at) }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(friendly(error));
  if (!count) return fail("공지를 찾지 못했거나 고칠 권한이 없습니다.");
  revalidateGroupware(`/groupware/${id}`);
  return { ok: "저장했습니다." };
}

/** 공지 삭제(보관). 목록으로 돌아간다. */
export async function deleteNotice(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase, tenantId } = await ctx("notice.write");
  await supabase.from("notice").update({ deleted_at: new Date().toISOString() }).eq("id", id.data).eq("tenant_id", tenantId);
  revalidateGroupware(`/groupware/${id.data}`);
  redirect("/groupware");
}

/** 공지 읽음 표시(본인). 상세 화면이 열릴 때 한 번 부른다. */
export async function markNoticeRead(noticeId: string) {
  const id = uuid.safeParse(noticeId);
  if (!id.success) return;
  const session = await requireTenant();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notice_read")
    .upsert({ notice_id: id.data, profile_id: session.user.id }, { onConflict: "notice_id,profile_id", ignoreDuplicates: true });
  if (error) return;
  revalidateGroupware(`/groupware/${id.data}`);
}

// ---------------------------------------------------------------- 조직: 부서 · 직위 · 배치
const departmentInput = z.object({
  name: z.string().trim().min(1).max(40),
  parent_id: optUuid,
  branch_id: optUuid,
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
});
const DEPT_DENIED = "부서·직위를 바꿀 권한이 없습니다. (데이터베이스 정책상 사업체 설정 권한이 필요합니다)";

export async function createDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = departmentInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("부서 이름(40자 이내)과 순서를 확인해 주세요.");
  const { supabase, tenantId } = await ctx("member.manage");
  const { error } = await supabase.from("department").insert({ tenant_id: tenantId, ...parsed.data, sort_order: parsed.data.sort_order ?? 0 });
  if (error) return fail(friendly(error, DEPT_DENIED));
  revalidatePath("/groupware/org");
  return { ok: "부서를 추가했습니다." };
}

export async function updateDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = departmentInput.extend({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("부서 이름(40자 이내)과 순서를 확인해 주세요.");
  const { supabase, tenantId } = await ctx("member.manage");
  const { id, parent_id, ...rest } = parsed.data;
  if (parent_id === id) return fail("자기 자신을 상위 부서로 둘 수 없습니다.");
  if (parent_id) {
    // 상위 부서를 따라 올라가다 자기 자신이 나오면 순환
    const { data: all } = await supabase.from("department").select("id, parent_id").eq("tenant_id", tenantId).is("deleted_at", null);
    const parentOf = new Map(((all ?? []) as { id: string; parent_id: string | null }[]).map((d) => [d.id, d.parent_id]));
    let cur: string | null = parent_id;
    for (let guard = 0; cur && guard < 100; guard++) {
      if (cur === id) return fail("하위 부서를 상위 부서로 둘 수 없습니다.");
      cur = parentOf.get(cur) ?? null;
    }
  }
  const { error, count } = await supabase
    .from("department")
    .update({ ...rest, parent_id, sort_order: rest.sort_order ?? 0 }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(friendly(error, DEPT_DENIED));
  if (!count) return fail("부서를 찾지 못했거나 고칠 권한이 없습니다.");
  revalidatePath("/groupware/org");
  return { ok: "저장했습니다." };
}

/** 부서 삭제(보관). 하위 부서는 한 단계 위로 올린다. 구성원의 부서 값은 그대로 두고 화면에서 미배정으로 보인다. */
export async function deleteDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("member.manage");
  const { data: dept } = await supabase.from("department").select("id, parent_id").eq("id", parsed.data.id).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle();
  if (!dept) return fail("부서를 찾지 못했습니다.");
  const { error, count } = await supabase
    .from("department")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", dept.id)
    .eq("tenant_id", tenantId);
  if (error) return fail(friendly(error, DEPT_DENIED));
  if (!count) return fail("부서를 지울 권한이 없습니다.");
  await supabase.from("department").update({ parent_id: dept.parent_id }).eq("tenant_id", tenantId).eq("parent_id", dept.id).is("deleted_at", null);
  revalidatePath("/groupware/org");
  return { ok: "부서를 지웠습니다." };
}

const positionInput = z.object({ name: z.string().trim().min(1).max(30), rank: z.coerce.number().int().min(0).max(999).optional() });

export async function createPosition(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = positionInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("직위 이름(30자 이내)과 순위를 확인해 주세요.");
  const { supabase, tenantId } = await ctx("member.manage");
  const { error } = await supabase.from("job_position").insert({ tenant_id: tenantId, name: parsed.data.name, rank: parsed.data.rank ?? 0 });
  if (error) return fail(friendly(error, DEPT_DENIED));
  revalidatePath("/groupware/org");
  return { ok: "직위를 추가했습니다." };
}

export async function updatePosition(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = positionInput.extend({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("직위 이름(30자 이내)과 순위를 확인해 주세요.");
  const { supabase, tenantId } = await ctx("member.manage");
  const { error, count } = await supabase
    .from("job_position")
    .update({ name: parsed.data.name, rank: parsed.data.rank ?? 0 }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return fail(friendly(error, DEPT_DENIED));
  if (!count) return fail("직위를 찾지 못했거나 고칠 권한이 없습니다.");
  revalidatePath("/groupware/org");
  return { ok: "저장했습니다." };
}

/** 구성원의 부서·직위·직함 */
export async function assignOrg(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, department_id: optUuid, position_id: optUuid, job_title: optText(30) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("member.manage");
  const { id, ...rest } = parsed.data;
  const { error, count } = await supabase.from("membership").update(rest, { count: "exact" }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail(friendly(error));
  if (!count) return fail("내 범위 밖의 구성원은 바꿀 수 없습니다.");
  revalidatePath("/groupware/org");
  revalidatePath("/settings/members");
  return { ok: "배치했습니다." };
}

// ---------------------------------------------------------------- 결재
const approvalInput = z.object({
  kind: z.enum(["general", "purchase", "expense", "leave", "contract_cancel", "discount", "other"]),
  title: z.string().trim().min(1).max(120),
  body: optText(10000),
  amount: z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      if (!v) return null;
      const digits = v.replace(/[^\d.-]/g, "");
      return digits ? Number(digits) : Number.NaN; // 숫자가 아니면 아래 검증에서 걸린다
    })
    .pipe(z.number().int().min(0).max(99_999_999_999_999).nullable()),
  approver_1: optUuid,
  approver_2: optUuid,
  approver_3: optUuid,
  mode: z.enum(["draft", "submit"]).optional(),
});

/** 결재선: 순서대로 1~3명, 중복·본인 제외 */
function approverIds(d: { approver_1: string | null; approver_2: string | null; approver_3: string | null }, me: string): string[] | string {
  const ids = [d.approver_1, d.approver_2, d.approver_3].filter((v): v is string => Boolean(v));
  if (new Set(ids).size !== ids.length) return "같은 결재자를 두 번 넣을 수 없습니다.";
  if (ids.includes(me)) return "본인은 결재자가 될 수 없습니다.";
  return ids;
}

export async function createApproval(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = approvalInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("종류·제목(120자 이내)·금액(숫자)을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("approval.write");
  const ids = approverIds(parsed.data, session.user.id);
  if (typeof ids === "string") return fail(ids);
  const submit = parsed.data.mode === "submit";
  if (submit && ids.length === 0) return fail("상신하려면 결재자를 한 명 이상 골라 주세요.");
  const { kind, title, body, amount } = parsed.data;
  const { data: doc, error } = await supabase
    .from("approval_doc")
    .insert({ tenant_id: tenantId, branch_id: session.current.branch_id, kind, title, body, amount, requester_id: session.user.id })
    .select("id")
    .single();
  if (error) return fail(friendly(error, "결재를 올릴 권한이 없습니다."));
  if (ids.length) {
    const { error: stepError } = await supabase
      .from("approval_step")
      .insert(ids.map((approver_id, i) => ({ doc_id: doc.id, tenant_id: tenantId, step_no: i + 1, approver_id })));
    if (stepError) return fail(friendly(stepError, "결재선을 저장할 권한이 없습니다."));
  }
  if (submit) {
    const { error: submitError } = await supabase.from("approval_doc").update({ status: "submitted" }).eq("id", doc.id).eq("tenant_id", tenantId);
    if (submitError) return fail(friendly(submitError));
  }
  revalidateGroupware("/groupware/approvals");
  redirect(`/groupware/approvals/${doc.id}`);
}

/** 작성 중인 문서만: 내용을 고치고 결재선을 통째로 바꾼다. mode=submit 이면 바로 상신. */
export async function updateApproval(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = approvalInput.extend({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("종류·제목(120자 이내)·금액(숫자)을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("approval.write");
  const ids = approverIds(parsed.data, session.user.id);
  if (typeof ids === "string") return fail(ids);
  const submit = parsed.data.mode === "submit";
  if (submit && ids.length === 0) return fail("상신하려면 결재자를 한 명 이상 골라 주세요.");
  const { id, kind, title, body, amount } = parsed.data;
  const { data: doc } = await supabase.from("approval_doc").select("id, status, requester_id").eq("id", id).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle();
  if (!doc) return fail("결재 문서를 찾지 못했습니다.");
  if (doc.requester_id !== session.user.id) return fail("상신자만 고칠 수 있습니다.");
  if (doc.status !== "draft") return fail("작성 중인 문서만 고칠 수 있습니다.");
  const { error } = await supabase.from("approval_doc").update({ kind, title, body, amount }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail(friendly(error));
  const { error: delError } = await supabase.from("approval_step").delete().eq("doc_id", id).eq("tenant_id", tenantId);
  if (delError) return fail(friendly(delError));
  if (ids.length) {
    const { error: stepError } = await supabase
      .from("approval_step")
      .insert(ids.map((approver_id, i) => ({ doc_id: id, tenant_id: tenantId, step_no: i + 1, approver_id })));
    if (stepError) return fail(friendly(stepError, "결재선을 저장할 권한이 없습니다."));
  }
  if (submit) {
    const { error: submitError } = await supabase.from("approval_doc").update({ status: "submitted" }).eq("id", id).eq("tenant_id", tenantId);
    if (submitError) return fail(friendly(submitError));
  }
  revalidateGroupware("/groupware/approvals", `/groupware/approvals/${id}`);
  return { ok: submit ? "상신했습니다." : "저장했습니다." };
}

export async function submitApproval(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("approval.write");
  const { error, count } = await supabase
    .from("approval_doc")
    .update({ status: "submitted" }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .eq("requester_id", session.user.id)
    .eq("status", "draft");
  if (error) return fail(friendly(error));
  if (!count) return fail("작성 중인 내 문서만 상신할 수 있습니다.");
  revalidateGroupware("/groupware/approvals", `/groupware/approvals/${parsed.data.id}`);
  return { ok: "상신했습니다. 1단계 결재자에게 알림이 갑니다." };
}

/** 상신자가 작성 중·결재 중인 문서를 취소 */
export async function cancelApproval(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const session = await requireTenant();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("approval_doc")
    .update({ status: "canceled" }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", session.current.tenant_id)
    .eq("requester_id", session.user.id)
    .in("status", ["draft", "submitted"]);
  if (error) return fail(friendly(error));
  if (!count) return fail("작성 중이거나 결재 중인 내 문서만 취소할 수 있습니다.");
  revalidateGroupware("/groupware/approvals", `/groupware/approvals/${parsed.data.id}`);
  return { ok: "취소했습니다." };
}

/** 결재 단계 승인·반려. 누가 결재할 수 있는지는 트리거가 확인한다. */
export async function decideStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, doc_id: uuid, decision: z.enum(["approved", "rejected"]), comment: optText(1000) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const session = await requireTenant();
  if (!session.can("approval.decide")) return fail("결재 권한이 없습니다.");
  const supabase = await createClient();
  const { id, doc_id, decision, comment } = parsed.data;
  const { error, count } = await supabase
    .from("approval_step")
    .update({ status: decision, comment }, { count: "exact" })
    .eq("id", id)
    .eq("doc_id", doc_id)
    .eq("tenant_id", session.current.tenant_id)
    .eq("status", "pending");
  if (error) return fail(friendly(error, "이 단계를 결재할 권한이 없습니다."));
  if (!count) return fail("지금 결재 차례인 단계가 아니거나 결재할 권한이 없습니다.");
  revalidateGroupware("/groupware/approvals", `/groupware/approvals/${doc_id}`);
  return { ok: decision === "approved" ? "승인했습니다." : "반려했습니다." };
}

// ---------------------------------------------------------------- 휴가
const leaveKind = z.enum(["annual", "half_am", "half_pm", "sick", "family", "unpaid", "other"]);

export async function createLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ kind: leaveKind, start_date: ymd, end_date: z.string().trim().optional(), reason: optText(500) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("종류와 날짜를 확인해 주세요.");
  const { kind, start_date, reason } = parsed.data;
  const half = kind === "half_am" || kind === "half_pm";
  const end_date = half || !parsed.data.end_date ? start_date : parsed.data.end_date;
  if (!ymd.safeParse(end_date).success) return fail("끝 날짜를 확인해 주세요.");
  if (end_date < start_date) return fail("끝 날짜가 시작 날짜보다 앞설 수 없습니다.");
  const span = (new Date(`${end_date}T00:00:00Z`).getTime() - new Date(`${start_date}T00:00:00Z`).getTime()) / 86_400_000;
  if (!Number.isFinite(span) || span > 60) return fail("휴가는 한 번에 60일까지 신청할 수 있습니다.");
  const days = leaveDays(kind, start_date, end_date);
  const session = await requireTenant();
  const supabase = await createClient();
  const { error } = await supabase.from("leave_request").insert({
    tenant_id: session.current.tenant_id,
    branch_id: session.current.branch_id,
    profile_id: session.user.id,
    kind,
    start_date,
    end_date,
    days,
    reason,
  });
  if (error) return fail(friendly(error, "휴가를 신청할 권한이 없습니다."));
  revalidateGroupware("/groupware/leave");
  return { ok: `휴가를 신청했습니다 (${days}일). 결재자가 승인하면 알림이 옵니다.` };
}

export async function cancelLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const session = await requireTenant();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("leave_request")
    .update({ status: "canceled" }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", session.current.tenant_id)
    .eq("profile_id", session.user.id)
    .eq("status", "pending");
  if (error) return fail(friendly(error));
  if (!count) return fail("대기 중인 내 휴가만 취소할 수 있습니다.");
  revalidateGroupware("/groupware/leave");
  return { ok: "취소했습니다." };
}

export async function decideLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, decision: z.enum(["approved", "rejected"]), comment: optText(500) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("approval.decide");
  const { error, count } = await supabase
    .from("leave_request")
    .update({ status: parsed.data.decision, comment: parsed.data.comment }, { count: "exact" })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .eq("status", "pending");
  if (error) return fail(friendly(error, "휴가 결재 권한이 없습니다."));
  if (!count) return fail("이미 처리됐거나 내 범위 밖의 휴가입니다.");
  revalidateGroupware("/groupware/leave");
  return { ok: parsed.data.decision === "approved" ? "승인했습니다." : "반려했습니다." };
}

/** 연도별 연차 부여(있으면 덮어쓴다) */
export async function setLeaveGrant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      profile_id: uuid,
      year: z.coerce.number().int().min(2000).max(2100),
      days: z.coerce.number().min(0).max(365).refine((v) => Number.isInteger(v * 2), "0.5일 단위"),
      memo: optText(200),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("구성원·연도·일수(0.5일 단위)를 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("member.manage");
  const { error } = await supabase
    .from("leave_grant")
    .upsert({ tenant_id: tenantId, ...parsed.data, created_by: session.user.id }, { onConflict: "tenant_id,profile_id,year" });
  if (error) return fail(friendly(error, "연차를 부여할 권한이 없습니다."));
  revalidateGroupware("/groupware/leave");
  return { ok: `${parsed.data.year}년 연차 ${parsed.data.days}일을 부여했습니다.` };
}
