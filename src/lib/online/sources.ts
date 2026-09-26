// 사업체별 온라인 기록 출처. 사업체 설정 화면이 아니라 배포 환경 변수로만 연결한다 —
// 다른 사업체 홈페이지 DB 키나 광고 도구 토큰을 사업체 관리자가 고르게 두면, 주소를 바꿔 키를 빼낼 수 있기 때문이다.
//
// ONLINE_SOURCES = JSON 배열. 값에는 비밀이 없고, 비밀이 든 환경 변수의 "이름"만 적는다.
//   [{ "tenant": "<사업체 uuid>",
//      "events_url": "https://<홈페이지 supabase>.supabase.co",   // site_events 가 있는 PostgREST
//      "events_key_env": "NANOMASTER_SUPABASE_SECRET_KEY",          // 그 프로젝트의 서버 키가 든 변수 이름
//      "ads_repo": "kdolbae/nanomaster-ads",                         // data/daily_cost.json 이 있는 저장소 (없으면 자동 광고비 없음)
//      "ads_token_env": "ADS_BOARD_TOKEN" }]                         // 그 저장소 읽기 토큰이 든 변수 이름
export type OnlineSource = {
  tenant: string;
  events: { url: string; key: string } | null;
  ads: { repo: string; path: string; token: string } | null;
};

type Raw = { tenant?: unknown; events_url?: unknown; events_key_env?: unknown; ads_repo?: unknown; ads_path?: unknown; ads_token_env?: unknown };

const envName = (v: unknown) => (typeof v === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(v) ? v : null);
const secret = (name: unknown) => {
  const n = envName(name);
  return n ? process.env[n]?.trim() || null : null;
};

let parsed: { raw: string; list: Raw[] } | null = null;
function entries(): Raw[] {
  const raw = process.env.ONLINE_SOURCES ?? "";
  if (parsed?.raw === raw) return parsed.list;
  let list: Raw[] = [];
  try {
    const j = raw ? JSON.parse(raw) : [];
    list = Array.isArray(j) ? j : [];
  } catch {
    console.error("[online] ONLINE_SOURCES 가 JSON 배열이 아닙니다.");
  }
  parsed = { raw, list };
  return list;
}

export function sourceFor(tenantId: string): OnlineSource {
  const e = entries().find((x) => x.tenant === tenantId);
  if (!e) return { tenant: tenantId, events: null, ads: null };
  // https 만. 개발 중에는 로컬 Supabase(http://127.0.0.1:54321)도 허용한다.
  const okUrl = (u: string) => /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(u) || (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(u));
  const url = typeof e.events_url === "string" && okUrl(e.events_url) ? e.events_url.replace(/\/$/, "") : null;
  const key = secret(e.events_key_env);
  const repo = typeof e.ads_repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(e.ads_repo) ? e.ads_repo : null;
  const path = typeof e.ads_path === "string" && /^[\w./-]+\.json$/.test(e.ads_path) ? e.ads_path : "data/daily_cost.json";
  const token = secret(e.ads_token_env);
  return {
    tenant: tenantId,
    events: url && key ? { url, key } : null,
    ads: repo && token ? { repo, path, token } : null,
  };
}
