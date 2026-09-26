/** 고객 전자서명 공용 타입·라벨 (서버·클라이언트 공용, DB 호출 없음) */

export type SignatureSummary = {
  id?: string;
  signed_at: string;
  signer_name: string;
  method: "device" | "link";
  material_hash?: string;
  record_hash: string;
  signature_data: string;
  consents?: Record<string, boolean>;
  witnessed_by?: string | null;
  changed?: boolean;
};

export type SnapshotLine = { name: string; work_area_code: string | null; qty: number; unit_price: number; discount: number; amount: number };
export type ContractSnapshot = {
  contract_no: string;
  contract_date: string;
  tenant: { name: string; business_no: string | null };
  customer: { name: string; phone: string | null };
  site: { name: string | null; dong: string | null; ho: string | null; address: string | null };
  lines: SnapshotLine[];
  sale_total: number;
  jobs: { work_area_code: string | null; kind: string; scheduled_date: string | null; time_slot: string }[];
  sales_owner: string | null;
  memo: string | null;
};

/** RPC contract_signing_info (직원 화면) */
export type SigningInfo = { terms: string; snapshot: ContractSnapshot; material_hash: string; signature: SignatureSummary | null };

/** RPC customer_signing (고객 링크) */
export type CustomerSigning = { can_sign: boolean; terms: string; phone_check: boolean; signature: SignatureSummary | null };

export const SIGN_METHOD: Record<string, string> = { device: "현장 기기", link: "고객 링크" };

/** 동의 항목. required 는 서명 조건(DB 트리거도 같은 규칙) */
export const CONSENT_ITEMS: { key: "terms" | "privacy" | "marketing"; label: string; required: boolean }[] = [
  { key: "terms", label: "계약 내용과 약관을 확인했고 이에 동의합니다.", required: true },
  { key: "privacy", label: "계약 이행을 위한 개인정보(이름·연락처·주소) 수집·이용에 동의합니다.", required: true },
  { key: "marketing", label: "시공 안내와 혜택 소식을 받겠습니다. (선택)", required: false },
];

export const SIGNATURE_DATA_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
export const SIGNATURE_MAX = 300000;

/** 서명 뒤 계약 내용(계약자·현장·품목·금액)이 바뀌었는가 */
export function signatureStale(info: Pick<SigningInfo, "material_hash" | "signature">): boolean {
  return Boolean(info.signature?.material_hash && info.signature.material_hash !== info.material_hash);
}

/** 기록 확인번호: 해시 앞 12자리를 4자리씩 */
export function recordCode(hash: string | null | undefined): string {
  const h = (hash ?? "").slice(0, 12).toUpperCase();
  return h ? `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}` : "";
}
