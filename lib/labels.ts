// enum → 한글 라벨 및 배지 색상 매핑

export const contractStatusLabel: Record<string, string> = {
  DRAFT: "초안",
  REVIEW: "검토",
  SIGNED: "체결",
  ACTIVE: "이행중",
  RENEWED: "갱신",
  EXPIRED: "만료",
  TERMINATED: "해지",
};

export const contractStatusTone: Record<string, string> = {
  DRAFT: "gray",
  REVIEW: "blue",
  SIGNED: "green",
  ACTIVE: "green",
  RENEWED: "blue",
  EXPIRED: "gray",
  TERMINATED: "red",
};

// 계약 생애주기 상태 전이 규칙
export const contractTransitions: Record<string, string[]> = {
  DRAFT: ["REVIEW", "TERMINATED"],
  REVIEW: ["SIGNED", "DRAFT", "TERMINATED"],
  SIGNED: ["ACTIVE", "TERMINATED"],
  ACTIVE: ["RENEWED", "EXPIRED", "TERMINATED"],
  RENEWED: ["ACTIVE", "EXPIRED", "TERMINATED"],
  EXPIRED: [],
  TERMINATED: [],
};

// 상태 전이 시 자동 기록할 이벤트 유형
export const statusEventType: Record<string, string> = {
  SIGNED: "SIGNED",
  RENEWED: "RENEWED",
  TERMINATED: "TERMINATED",
  EXPIRED: "EXPIRED",
};

export const eventTypeLabel: Record<string, string> = {
  CREATED: "생성",
  SIGNED: "체결",
  AMENDED: "변경",
  RENEWED: "갱신",
  TERMINATED: "해지",
  EXPIRED: "만료",
};

export const partyTypeLabel: Record<string, string> = {
  COMPANY: "법인",
  INDIVIDUAL: "개인",
};

export const settlementKindLabel: Record<string, string> = {
  INVOICE: "청구",
  RECEIPT: "수납",
  PAYMENT: "지급",
};

export const settlementStatusLabel: Record<string, string> = {
  PENDING: "대기",
  PARTIAL: "부분",
  PAID: "완료",
  OVERDUE: "연체",
  CANCELED: "취소",
};

export const settlementStatusTone: Record<string, string> = {
  PENDING: "gray",
  PARTIAL: "blue",
  PAID: "green",
  OVERDUE: "red",
  CANCELED: "gray",
};

export const documentKindLabel: Record<string, string> = {
  CONTRACT: "계약서",
  ATTACHMENT: "첨부",
  AMENDMENT: "변경계약서",
  OTHER: "기타",
};

export const userRoleLabel: Record<string, string> = {
  ADMIN: "관리자",
  MEMBER: "일반",
  VIEWER: "조회",
};

export const assetLayerLabel: Record<string, string> = {
  BRONZE: "Bronze",
  SILVER: "Silver",
  GOLD: "Gold",
};

export const qualityDimensionLabel: Record<string, string> = {
  COMPLETENESS: "완전성",
  VALIDITY: "유효성",
  UNIQUENESS: "유일성",
  CONSISTENCY: "정합성",
  TIMELINESS: "적시성",
};

export const qualityStatusTone: Record<string, string> = {
  PASS: "green",
  WARN: "blue",
  FAIL: "red",
};
