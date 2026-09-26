import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** 서비스 키 클라이언트: 서버 전용(RLS 우회). 라우트 핸들러의 인입·발송 처리에만 쓴다. 브라우저로 절대 내보내지 않는다. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
