/** 유입 경로(홈페이지 이벤트의 source) → 채널 묶음. 온라인 성과 화면·영업 분석 요약·DB 체크(app.is_online_channel)가 같은 키를 쓴다.
 *  메타는 utm_source=meta 와 utm 없는 facebook.com·instagram.com referrer 를 합친다. 사이트 안 이동(internal)은 null. */
export const CHANNELS = ["inNaverAd", "inMeta", "inNaver", "inGoogle", "inDirect", "inOther"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  inNaverAd: "네이버 광고",
  inMeta: "메타 광고",
  inNaver: "네이버 검색",
  inGoogle: "구글",
  inDirect: "직접",
  inOther: "그 외",
};

export const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);

export function inflowGroup(src: string): Channel | null {
  if (src === "naver_ad") return "inNaverAd";
  if (src === "naver") return "inNaver";
  if (/^(meta|facebook|fb|instagram|ig)$/i.test(src) || /(^|\.)(facebook|instagram)\.com$/i.test(src)) return "inMeta";
  if (src === "google") return "inGoogle";
  if (src === "direct") return "inDirect";
  if (src === "internal") return null;
  return "inOther";
}

export const OUTCOME_KEYS = ["won", "valid", "none"] as const;
export type OutcomeKey = (typeof OUTCOME_KEYS)[number];
export const isOutcomeKey = (v: unknown): v is OutcomeKey => typeof v === "string" && (OUTCOME_KEYS as readonly string[]).includes(v);

export type OutcomeLabel = { key: OutcomeKey; name: string; description: string | null; sort: number };
export const DEFAULT_LABELS: OutcomeLabel[] = [
  { key: "won", name: "계약 성사", description: "상담·견적 뒤 실제 계약까지 간 건", sort: 1 },
  { key: "valid", name: "유효 상담", description: "실제 손님과 상담·견적이 오갔지만 계약 전이거나 계약하지 않은 건", sort: 2 },
  { key: "none", name: "효과 없음", description: "잘못 누름·연결 안 됨·스팸·우리 서비스가 아닌 문의", sort: 3 },
];

/** 사업체가 바꾼 이름을 기본 이름 위에 덮는다. */
export function mergeLabels(rows: { key: string; name: string; description: string | null }[]): OutcomeLabel[] {
  return DEFAULT_LABELS.map((d) => {
    const r = rows.find((x) => x.key === d.key);
    return r ? { ...d, name: r.name, description: r.description } : d;
  });
}

/** 전화번호 모양. DB 의 app.has_phone_like 와 같은 규칙(0 으로 시작하는 9~11자리). */
export const PHONE_LIKE = /(^|[^0-9])0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}([^0-9]|$)/;
