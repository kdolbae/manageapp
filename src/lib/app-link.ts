/**
 * 집대리 소비자 앱(kdolbae/jipdarie) 연동.
 *  - 앱 공종 id 는 앱 src/data/services.ts 와 같아야 한다. 상품에 붙이면 계약 금액이 앱 예상가격 집계에 들어간다.
 *  - 공개 API 는 /api/public/v1/* (앱이 직접 부른다. 계약 비밀 토큰 또는 사업체 slug 로만 연다)
 */
export const APP_SERVICES: { id: string; label: string }[] = [
  { id: "defect_repair", label: "하자보수" },
  { id: "demolition", label: "철거" },
  { id: "film", label: "필름" },
  { id: "wallpaper", label: "도배" },
  { id: "flooring", label: "마루/장판" },
  { id: "elastic_coating", label: "탄성코팅" },
  { id: "grout", label: "줄눈" },
  { id: "nano_coating", label: "나노코팅" },
  { id: "silicone", label: "실리콘" },
  { id: "built_in", label: "붙박이장" },
  { id: "middle_door", label: "중문" },
  { id: "screen", label: "방충망" },
  { id: "lighting", label: "조명" },
  { id: "sick_house", label: "새집증후군" },
  { id: "cleaning", label: "입주청소" },
];

export const APP_SERVICE_IDS = APP_SERVICES.map((s) => s.id) as [string, ...string[]];

export function appServiceLabel(id: string | null | undefined): string | null {
  return id ? (APP_SERVICES.find((s) => s.id === id)?.label ?? id) : null;
}

/** 공개 API 공용 CORS. 앱(웹·Capacitor)은 출처가 여러 개라 열어 두고, 자료는 토큰·slug 로만 연다. */
export const PUBLIC_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
export const TOKEN_RE = /^[0-9a-f]{16,64}$/;
