"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";

const uuid = z.string().uuid();
const optUuid = z.string().uuid().or(z.literal("")).optional().transform((v) => (v ? v : null));
const optDate = z.string().trim().optional().transform((v) => (v ? v : null)).pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const fail = (message: string): ActionState => ({ error: message });
const friendly = (code: string | undefined, message: string) => (code === "42501" ? "권한이 없습니다." : message);

function revalidateBoards() {
  revalidatePath("/assign");
  revalidatePath("/jobs");
  revalidatePath("/jobs/today");
}

/** 배정 보드에서 담당·날짜·시간대 바꾸기 */
export async function quickAssign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, technician_id: optUuid, scheduled_date: optDate, time_slot: z.enum(["any", "am", "pm"]).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const session = await requireTenant();
  if (!session.can("job.write") && !session.can("job.assign")) return fail("권한이 없습니다.");
  const supabase = await createClient();
  const { id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {};
  if (session.can("job.write")) {
    patch.scheduled_date = rest.scheduled_date;
    if (rest.time_slot) patch.time_slot = rest.time_slot;
  }
  if (session.can("job.assign")) patch.technician_id = rest.technician_id;
  const { data: job } = await supabase.from("job").select("contract_id").eq("id", id).maybeSingle();
  const { error, count } = await supabase.from("job").update(patch, { count: "exact" }).eq("id", id).eq("tenant_id", session.current.tenant_id);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("시공 건을 찾지 못했습니다.");
  revalidateBoards();
  if (job) revalidatePath(`/contracts/${job.contract_id}`);
  return { ok: "배정했습니다." };
}

/** 기사 화면: 상태만 바꾸기 (시작·완료·연기) */
export async function setJobStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, status: z.enum(["assigned", "in_progress", "done", "postponed"]), memo: z.string().trim().max(300).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const session = await requireTenant();
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.memo) patch.memo = parsed.data.memo;
  const { data: job } = await supabase.from("job").select("contract_id, status").eq("id", parsed.data.id).maybeSingle();
  if (job?.status === "done" && parsed.data.status === "in_progress") return fail("이미 완료된 시공입니다.");
  if (job?.status === parsed.data.status) return { ok: "이미 반영되어 있습니다." };
  const { error, count } = await supabase.from("job").update(patch, { count: "exact" }).eq("id", parsed.data.id).eq("tenant_id", session.current.tenant_id);
  if (error) return fail(friendly(error.code, error.message));
  if (!count) return fail("시공 건을 찾지 못했거나 권한이 없습니다.");
  revalidateBoards();
  if (job) revalidatePath(`/contracts/${job.contract_id}`);
  return { ok: parsed.data.status === "done" ? "시공 완료로 기록했습니다." : parsed.data.status === "in_progress" ? "시공을 시작했습니다." : "저장했습니다." };
}

export async function setCapacity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), branch_id: optUuid, max_jobs: z.coerce.number().int().min(0).max(999) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("날짜와 건수를 확인해 주세요.");
  const session = await requireTenant();
  if (!session.can("job.assign")) return fail("권한이 없습니다.");
  const supabase = await createClient();
  const tid = session.current.tenant_id;
  let q = supabase.from("daily_capacity").select("id").eq("tenant_id", tid).eq("date", parsed.data.date);
  q = parsed.data.branch_id ? q.eq("branch_id", parsed.data.branch_id) : q.is("branch_id", null);
  const { data: existing } = await q.maybeSingle();
  const { error } = existing
    ? await supabase.from("daily_capacity").update({ max_jobs: parsed.data.max_jobs }).eq("id", existing.id)
    : await supabase.from("daily_capacity").insert({ tenant_id: tid, date: parsed.data.date, branch_id: parsed.data.branch_id, max_jobs: parsed.data.max_jobs });
  if (error) return fail(friendly(error.code, error.message));
  revalidateBoards();
  return { ok: "캐파를 저장했습니다." };
}

export async function toggleOff(formData: FormData) {
  const parsed = z.object({ technician_id: uuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), on: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const session = await requireTenant();
  const supabase = await createClient();
  const tid = session.current.tenant_id;
  if (parsed.data.on === "1") {
    await supabase.from("technician_off").insert({ tenant_id: tid, technician_id: parsed.data.technician_id, date: parsed.data.date });
  } else {
    await supabase.from("technician_off").delete().eq("tenant_id", tid).eq("technician_id", parsed.data.technician_id).eq("date", parsed.data.date);
  }
  revalidateBoards();
}
