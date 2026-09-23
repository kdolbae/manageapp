"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireTenant } from "@/lib/auth/session";
import type { ActionState } from "@/lib/actions/auth";
import { MEDIA_BUCKET, parseHashtags } from "@/lib/media";

const uuid = z.string().uuid();
const optUuid = z.string().uuid().or(z.literal("")).optional().transform((v) => (v ? v : null));
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optUrl = z.string().trim().max(500).optional().transform((v) => (v ? v : null)).pipe(z.string().url().nullable());
const optInt = z.string().trim().optional().transform((v) => (v ? Number(v) : null)).pipe(z.number().int().min(0).max(2_147_483_647).nullable());
const MEDIA_KINDS = ["before", "after", "process", "issue", "receipt", "review", "other"] as const;
const REVIEW_CHANNELS = ["app", "kakao", "naver", "google", "instagram", "manual"] as const;
const REVIEW_STATUSES = ["pending", "approved", "hidden"] as const;
const POST_KINDS = ["instagram", "naver_blog", "kakao_channel", "youtube_short", "blog", "ad", "other"] as const;
const POST_STATUSES = ["draft", "ready", "published", "archived"] as const;

const fail = (message: string): ActionState => ({ error: message });
/** 체크박스("on")·숨은 값("1") 을 boolean 으로 */
const flag = (v: FormDataEntryValue | null) => v === "on" || v === "1" || v === "true";
const friendly = (code: string | undefined, message: string, denied = "권한이 없습니다.") =>
  code === "42501" ? denied : code === "23505" ? "이미 등록된 항목입니다." : code === "23503" ? "연결하려는 기록을 찾지 못했습니다." : message;

async function ctx(permission: string) {
  const session = await requireTenant();
  if (!session.can(permission)) throw new Error("권한이 없습니다.");
  const supabase = await createClient();
  return { session, supabase, tenantId: session.current.tenant_id };
}

function revalidateMedia(jobId?: string | null, contractId?: string | null) {
  revalidatePath("/content");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (contractId) revalidatePath(`/contracts/${contractId}`);
}

// ---------------------------------------------------------------- 사진
/** 브라우저가 Storage 에 올린 뒤 호출: media_asset 행을 만든다. 계약·고객·지점은 트리거가 시공 건에서 채운다. */
export async function registerMedia(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      job_id: optUuid,
      contract_id: optUuid,
      kind: z.enum(MEDIA_KINDS).default("after"),
      path: z.string().trim().min(3).max(300),
      mime: optText(100),
      bytes: optInt,
      width: optInt,
      height: optInt,
      taken_at: optText(40),
      caption: optText(300),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("사진 정보를 확인해 주세요.");
  const { supabase, tenantId } = await ctx("content.write");
  const d = parsed.data;
  if (!d.path.startsWith(`${tenantId}/`) || d.path.includes("..")) return fail("사진 경로가 올바르지 않습니다.");
  if (!d.job_id && !d.contract_id) return fail("시공 건이나 계약에 붙여야 합니다.");
  const takenAt = d.taken_at && !Number.isNaN(new Date(d.taken_at).getTime()) ? new Date(d.taken_at).toISOString() : null;
  const { data, error } = await supabase
    .from("media_asset")
    .insert({ tenant_id: tenantId, job_id: d.job_id, contract_id: d.contract_id, kind: d.kind, bucket: MEDIA_BUCKET, path: d.path, mime: d.mime, bytes: d.bytes, width: d.width, height: d.height, taken_at: takenAt, caption: d.caption })
    .select("id, job_id, contract_id")
    .single();
  if (error) return fail(friendly(error.code, error.message));
  revalidateMedia(data.job_id, data.contract_id);
  return { ok: "사진을 등록했습니다." };
}

/** 설명·종류·태그·마케팅 사용 여부. 폼에 있는 항목만 바꾼다(마케팅은 set_marketing=1 이 같이 올 때만). */
export async function updateMedia(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, caption: optText(300), kind: z.enum(MEDIA_KINDS).optional(), tags: z.string().trim().max(500).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("content.write");
  const { id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {};
  if (formData.has("caption")) patch.caption = rest.caption;
  if (rest.kind) patch.kind = rest.kind;
  if (formData.has("tags")) patch.tags = parseHashtags(rest.tags);
  if (formData.has("set_marketing")) patch.marketing_ok = flag(formData.get("marketing_ok"));
  if (Object.keys(patch).length === 0) return fail("바꿀 내용이 없습니다.");
  const { data, error } = await supabase.from("media_asset").update(patch).eq("id", id).eq("tenant_id", tenantId).is("deleted_at", null).select("id, job_id, contract_id");
  if (error) return fail(friendly(error.code, error.message, patch.marketing_ok === true ? "마케팅 사용은 발행 권한이 있어야 켤 수 있습니다" : "권한이 없습니다."));
  if (!data?.length) return fail("사진을 찾지 못했거나 권한이 없습니다.");
  revalidateMedia(data[0].job_id, data[0].contract_id);
  return { ok: patch.marketing_ok === true ? "마케팅 사용 가능으로 표시했습니다." : patch.marketing_ok === false ? "마케팅 사용을 껐습니다." : "저장했습니다." };
}

/** 사진 삭제: 행은 deleted_at 만 찍고(보존), Storage 원본 제거는 최선 노력(본인이 올린 것만 정책상 지워진다). */
export async function deleteMedia(formData: FormData) {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { supabase, tenantId } = await ctx("content.write");
  const { data } = await supabase
    .from("media_asset")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .select("path, bucket, job_id, contract_id")
    .maybeSingle();
  if (!data) return;
  try {
    await supabase.storage.from(data.bucket ?? MEDIA_BUCKET).remove([data.path]);
  } catch {
    // 원본이 남아도 행이 deleted_at 이라 화면에는 안 보인다
  }
  revalidateMedia(data.job_id, data.contract_id);
}

// ---------------------------------------------------------------- 후기
export async function createReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      contract_id: optUuid,
      customer_id: optUuid,
      job_id: optUuid,
      rating: z.coerce.number().int().min(1).max(5),
      body: z.string().trim().min(1).max(4000),
      author_name: optText(60),
      channel: z.enum(REVIEW_CHANNELS).default("manual"),
      source_url: optUrl,
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("별점(1~5)과 내용을 확인해 주세요.");
  const { session, supabase, tenantId } = await ctx("content.write");
  const d = parsed.data;
  let customerId = d.customer_id;
  let branchId: string | null = session.current.branch_id;
  if (d.contract_id) {
    const { data: c } = await supabase.from("contract").select("customer_id, branch_id").eq("id", d.contract_id).eq("tenant_id", tenantId).maybeSingle();
    if (!c) return fail("계약을 찾지 못했습니다.");
    customerId = customerId ?? c.customer_id;
    branchId = c.branch_id ?? branchId;
  }
  const { error } = await supabase.from("review").insert({
    tenant_id: tenantId,
    branch_id: branchId,
    contract_id: d.contract_id,
    job_id: d.job_id,
    customer_id: customerId,
    channel: d.channel,
    rating: d.rating,
    body: d.body,
    author_name: d.author_name,
    source_url: d.source_url,
    consent_marketing: flag(formData.get("consent_marketing")),
  });
  if (error) return fail(friendly(error.code, error.message));
  revalidatePath("/content/reviews");
  revalidatePath("/content/posts");
  return { ok: "후기를 등록했습니다." };
}

/** 상태(승인은 발행 권한: DB 트리거가 막는다)·답글·마케팅 동의 */
export async function updateReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, status: z.enum(REVIEW_STATUSES).optional(), response: optText(2000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("content.write");
  const { id, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {};
  if (rest.status) patch.status = rest.status;
  if (formData.has("response")) patch.response = rest.response;
  if (formData.has("set_consent")) patch.consent_marketing = flag(formData.get("consent_marketing"));
  if (Object.keys(patch).length === 0) return fail("바꿀 내용이 없습니다.");
  const { data, error } = await supabase.from("review").update(patch).eq("id", id).eq("tenant_id", tenantId).is("deleted_at", null).select("id");
  if (error) return fail(friendly(error.code, error.message, rest.status === "approved" ? "후기 승인은 발행 권한이 필요합니다" : "권한이 없습니다."));
  if (!data?.length) return fail("후기를 찾지 못했거나 권한이 없습니다.");
  revalidatePath("/content/reviews");
  revalidatePath("/content/posts");
  return { ok: rest.status === "approved" ? "후기를 승인했습니다." : rest.status === "hidden" ? "후기를 숨겼습니다." : rest.status === "pending" ? "대기로 되돌렸습니다." : "저장했습니다." };
}

// ---------------------------------------------------------------- 콘텐츠
const postSchema = z.object({
  kind: z.enum(POST_KINDS).default("instagram"),
  title: optText(120),
  body: optText(5000),
  hashtags: z.string().trim().max(1000).optional(),
  review_id: optUuid,
  contract_id: optUuid,
  status: z.enum(POST_STATUSES).default("draft"),
  published_url: optUrl,
});

type PostValues = { kind: string; title: string | null; body: string | null; hashtags: string[]; media_ids: string[]; review_id: string | null; contract_id: string | null; status: string; published_url: string | null };

/** 폼 → 저장값. 사진은 마케팅 사용 가능한 것만 남긴다(체크박스 media_ids[]). */
async function postInput(formData: FormData, supabase: Awaited<ReturnType<typeof ctx>>["supabase"], tenantId: string): Promise<{ error: string } | { values: PostValues }> {
  const parsed = postSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "입력값을 확인해 주세요." };
  const d = parsed.data;
  if (d.status === "published" && !d.published_url) return { error: "발행됨으로 바꾸려면 발행된 글 주소를 적어 주세요." };
  const wanted = Array.from(new Set(formData.getAll("media_ids").map(String).filter((v) => uuid.safeParse(v).success))).slice(0, 30);
  let media_ids: string[] = [];
  if (wanted.length) {
    const { data } = await supabase.from("media_asset").select("id").in("id", wanted).eq("tenant_id", tenantId).eq("marketing_ok", true).is("deleted_at", null);
    const ok = new Set(((data ?? []) as { id: string }[]).map((m) => m.id));
    media_ids = wanted.filter((id) => ok.has(id));
  }
  let contractId = d.contract_id;
  if (!contractId && d.review_id) {
    const { data: r } = await supabase.from("review").select("contract_id").eq("id", d.review_id).eq("tenant_id", tenantId).maybeSingle();
    contractId = r?.contract_id ?? null;
  }
  return { values: { kind: d.kind, title: d.title, body: d.body, hashtags: parseHashtags(d.hashtags), media_ids, review_id: d.review_id, contract_id: contractId, status: d.status, published_url: d.published_url } };
}

export async function createPost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session, supabase, tenantId } = await ctx("content.write");
  const input = await postInput(formData, supabase, tenantId);
  if ("error" in input) return fail(input.error);
  const { data, error } = await supabase
    .from("content_post")
    .insert({ tenant_id: tenantId, branch_id: session.current.branch_id, ...input.values })
    .select("id")
    .single();
  if (error) return fail(friendly(error.code, error.message, input.values.status === "published" ? "콘텐츠 발행은 발행 권한이 필요합니다" : "권한이 없습니다."));
  revalidatePath("/content/posts");
  redirect(`/content/posts/${data.id}`);
}

export async function updatePost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const idParsed = uuid.safeParse(formData.get("id"));
  if (!idParsed.success) return fail("입력값을 확인해 주세요.");
  const { supabase, tenantId } = await ctx("content.write");
  const input = await postInput(formData, supabase, tenantId);
  if ("error" in input) return fail(input.error);
  const { data, error } = await supabase.from("content_post").update(input.values).eq("id", idParsed.data).eq("tenant_id", tenantId).is("deleted_at", null).select("id");
  if (error) return fail(friendly(error.code, error.message, input.values.status === "published" ? "콘텐츠 발행은 발행 권한이 필요합니다" : "권한이 없습니다."));
  if (!data?.length) return fail("콘텐츠를 찾지 못했거나 권한이 없습니다.");
  revalidatePath("/content/posts");
  revalidatePath(`/content/posts/${idParsed.data}`);
  return { ok: input.values.status === "published" ? "발행됨으로 저장했습니다." : "저장했습니다." };
}

export async function deletePost(formData: FormData) {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { supabase, tenantId } = await ctx("content.write");
  await supabase.from("content_post").update({ deleted_at: new Date().toISOString() }).eq("id", parsed.data.id).eq("tenant_id", tenantId).is("deleted_at", null);
  revalidatePath("/content/posts");
  redirect("/content/posts");
}
