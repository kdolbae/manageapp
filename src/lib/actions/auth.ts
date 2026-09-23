"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/origin";
import { TENANT_COOKIE } from "@/lib/auth/session";

export type ActionState = { error?: string; ok?: string };

const credentials = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

function safeNext(value: FormDataEntryValue | null) {
  const s = String(value ?? "/");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "이메일과 비밀번호(8자 이상)를 확인해 주세요." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "이메일 또는 비밀번호가 맞지 않습니다." };
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials
    .extend({ display_name: z.string().trim().min(1).max(40) })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      display_name: formData.get("display_name"),
    });
  if (!parsed.success) return { error: "이름, 이메일, 비밀번호(8자 이상)를 확인해 주세요." };
  const supabase = await createClient();
  const origin = await siteOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.display_name },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext(formData.get("next")))}`,
    },
  });
  if (error) return { error: error.message };
  if (!data.session) return { ok: "확인 메일을 보냈습니다. 메일의 링크를 누르면 로그인됩니다." };
  redirect(safeNext(formData.get("next")));
}

export async function signInWithMicrosoft(formData: FormData) {
  const supabase = await createClient();
  const origin = await siteOrigin();
  const next = safeNext(formData.get("next"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      scopes: "email openid profile",
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function switchTenant(formData: FormData) {
  const tenantId = String(formData.get("tenant") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) return;
  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, tenantId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/");
}

const tenantInput = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "영문 소문자·숫자·하이픈 2~31자"),
});

export async function createTenant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = tenantInput.safeParse({ name: formData.get("name"), slug: formData.get("slug") });
  if (!parsed.success) return { error: "사업체 이름과 주소 이름(영문 소문자·숫자·하이픈 2~31자)을 확인해 주세요." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_tenant", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });
  if (error) {
    if (error.code === "23505") return { error: "이미 쓰고 있는 주소 이름입니다. 다른 이름을 골라 주세요." };
    return { error: `사업체를 만들지 못했습니다: ${error.message}` };
  }
  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, String(data), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/");
}

export async function acceptInvitation(token: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { error: error.message };
  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, String(data), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return { ok: "참여했습니다." };
}
