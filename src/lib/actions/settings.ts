"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";

const uuid = z.string().uuid();
const scope = z.enum(["own", "branch", "tenant", "group"]);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

function fail(message: string): ActionState {
  return { error: message };
}

// ---------------------------------------------------------------- 사업체
export async function updateTenant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(60),
      business_no: optionalText(20),
      app_name: optionalText(30),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
      phone: optionalText(30),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요 (색은 #RRGGBB 형식).");
  const { supabase, tenantId } = await ctx("tenant.manage");
  const { data: current } = await supabase.from("tenant").select("brand").eq("id", tenantId).single();
  const brand = { ...((current?.brand as Record<string, unknown>) ?? {}) };
  brand.app_name = parsed.data.app_name ?? null;
  brand.color = parsed.data.color || null;
  brand.phone = parsed.data.phone ?? null;
  const { error } = await supabase
    .from("tenant")
    .update({ name: parsed.data.name, business_no: parsed.data.business_no ?? null, brand })
    .eq("id", tenantId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: "저장했습니다." };
}

// ---------------------------------------------------------------- 지점
const branchInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/),
  name: z.string().trim().min(1).max(40),
  phone: optionalText(30),
  address: optionalText(120),
});

export async function createBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = branchInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("지점 코드(영문·숫자 1~12자)와 이름을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("branch.manage");
  const { error } = await supabase.from("branch").insert({ tenant_id: tenantId, ...parsed.data });
  if (error) return fail(error.code === "23505" ? "같은 코드의 지점이 이미 있습니다." : error.message);
  revalidatePath("/settings/branches");
  return { ok: "지점을 추가했습니다." };
}

export async function updateBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = branchInput
    .omit({ code: true })
    .extend({ id: uuid, status: z.enum(["active", "inactive"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("branch.manage");
  const { id, ...rest } = parsed.data;
  const { error } = await supabase.from("branch").update(rest).eq("id", id).eq("tenant_id", tenantId);
  if (error) return fail(error.message);
  revalidatePath("/settings/branches");
  return { ok: "저장했습니다." };
}

// ---------------------------------------------------------------- 구성원
export async function updateMembership(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      id: uuid,
      role_id: uuid,
      scope,
      branch_id: z.string().uuid().or(z.literal("")),
      status: z.enum(["active", "suspended"]),
      job_title: optionalText(30),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("member.manage");
  const branchId = parsed.data.branch_id || null;
  if (parsed.data.scope === "branch" && !branchId) return fail("지점 범위에는 지점을 골라야 합니다.");
  const { data: target } = await supabase
    .from("membership")
    .select("profile_id")
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!target) return fail("구성원을 찾지 못했습니다.");
  if (target.profile_id === session.user.id && parsed.data.status === "suspended")
    return fail("본인 계정은 정지할 수 없습니다.");
  const { error, count } = await supabase
    .from("membership")
    .update(
      {
        role_id: parsed.data.role_id,
        scope: parsed.data.scope,
        branch_id: branchId,
        status: parsed.data.status,
        job_title: parsed.data.job_title ?? null,
      },
      { count: "exact" },
    )
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId);
  if (error) return fail(error.code === "42501" ? "대표 역할은 대표만 줄 수 있습니다." : error.message);
  if (!count) return fail("내 범위 밖의 구성원은 바꿀 수 없습니다.");
  revalidatePath("/settings/members");
  return { ok: "저장했습니다." };
}

export async function inviteMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email(),
      role_id: uuid,
      scope,
      branch_id: z.string().uuid().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("이메일과 역할을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("member.manage");
  const branchId = parsed.data.branch_id || null;
  if (parsed.data.scope === "branch" && !branchId) return fail("지점 범위에는 지점을 골라야 합니다.");
  const { error } = await supabase.from("invitation").insert({
    tenant_id: tenantId,
    email: parsed.data.email,
    role_id: parsed.data.role_id,
    scope: parsed.data.scope,
    branch_id: branchId,
    created_by: session.user.id,
  });
  if (error) return fail(error.message);
  revalidatePath("/settings/members");
  return { ok: "초대를 만들었습니다. 아래 목록의 링크를 전달해 주세요." };
}

export async function deleteInvitation(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase, tenantId } = await ctx("member.manage");
  await supabase.from("invitation").delete().eq("id", id.data).eq("tenant_id", tenantId);
  revalidatePath("/settings/members");
}
