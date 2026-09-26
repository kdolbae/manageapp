import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/** 서버 컴포넌트·서버 액션·라우트 핸들러용 Supabase 클라이언트 (요청 쿠키 기반). */
export async function createClient() {
  // cookies() 를 먼저 읽어 이 렌더링이 요청 시점(dynamic)임을 Next 에 알린다.
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  if (!url || !key) {
    throw new Error(
      "Supabase 환경변수가 없습니다: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy.ts 가 맡는다.
        }
      },
    },
  });
}
