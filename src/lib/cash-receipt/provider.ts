/**
 * 현금영수증 발행 대행사 어댑터. 국세청 전송은 인증 발행대행(ASP)을 거쳐야 하므로 사업체 설정의 provider 로 고른다.
 *  - popbill: 팝빌(링크허브). 환경변수 POPBILL_LINK_ID, POPBILL_SECRET_KEY, POPBILL_IS_TEST(기본 1 = 테스트 서버)
 *  - mock:    가짜 발행(국세청 전송 없음). 팀즈 연결을 먼저 시험할 때 쓴다. 이미지에 "시험 발행" 이 찍힌다.
 */
export type IssueInput = {
  corpNum: string;          // 가맹점(우리 사업체) 사업자번호, 숫자만
  mgtKey: string;           // 문서번호: 같은 번호로 두 번 발행되지 않는다
  tradeDate: string;        // yyyyMMdd (KST)
  usage: "income" | "expense";
  identityNum: string;      // 휴대폰 번호 또는 사업자번호
  customerName?: string | null;
  itemName: string;
  taxation: "taxable" | "exempt";
  total: number;
  supply: number;
  tax: number;
  orderNumber?: string;     // 계약번호
  franchise?: { name?: string; ceo?: string; addr?: string; tel?: string };
};

export type IssueResult = { confirmNum: string; tradeDate: string; raw: unknown };

export type LookupResult =
  | { state: "issued"; confirmNum: string; tradeDate: string; raw: unknown }
  | { state: "not_found" }
  | { state: "other"; raw: unknown };

export class ProviderError extends Error {
  constructor(message: string, public code: string, public duplicate = false) {
    super(message);
  }
}

export interface CashReceiptProvider {
  id: "popbill" | "mock";
  /** 즉시 발행. 같은 mgtKey 가 이미 있으면 ProviderError(duplicate=true). */
  issue(input: IssueInput): Promise<IssueResult>;
  /** 문서번호로 조회(응답을 못 받은 발행을 맞춰 보기). */
  lookup(corpNum: string, mgtKey: string): Promise<LookupResult>;
}

/** 가짜 발행: 문서번호로 정해지는 가짜 승인번호. */
export const mockProvider: CashReceiptProvider = {
  id: "mock",
  async issue(input) {
    const confirmNum = "TEST" + input.mgtKey.replace(/\D/g, "").slice(-5).padStart(5, "0");
    return { confirmNum, tradeDate: input.tradeDate, raw: { mock: true } };
  },
  async lookup() {
    return { state: "not_found" };
  },
};

export async function getProvider(id: string | undefined): Promise<CashReceiptProvider> {
  if (id === "popbill") {
    const { popbillProvider } = await import("./popbill");
    return popbillProvider();
  }
  return mockProvider;
}
