/**
 * 채팅방 현금영수증 요청 읽기.
 *  현장주소
 *  서울특별시 ○○구 ○○아파트 101동 1001호
 *  계약자명
 *  홍길동
 *  계약자연락처
 *  010-0000-0000
 *
 *  현금영수증 신청합니다
 * 항목은 "라벨 다음 줄" 또는 "라벨: 값" 둘 다 된다. 계약번호·금액·사업자번호(지출증빙)는 선택.
 */
export type CashReceiptAsk = {
  isRequest: boolean;
  address?: string;
  name?: string;
  phone?: string;         // 숫자만
  contractNo?: string;
  amount?: number;
  bizNo?: string;         // 숫자만 10자리 → 지출증빙용
  usage: "income" | "expense";
};

type Field = "address" | "name" | "phone" | "contractNo" | "amount" | "bizNo";

// 긴 라벨부터 맞춘다 ("계약자연락처" 가 "계약자" 보다 먼저)
const LABELS: [string, Field][] = (
  [
    ["현장 주소", "address"], ["현장주소", "address"], ["시공주소", "address"], ["주소", "address"],
    ["계약자 연락처", "phone"], ["계약자연락처", "phone"], ["고객 연락처", "phone"], ["고객연락처", "phone"], ["휴대폰번호", "phone"], ["휴대폰", "phone"], ["핸드폰", "phone"], ["전화번호", "phone"], ["연락처", "phone"],
    ["계약자명", "name"], ["계약자 성함", "name"], ["계약자", "name"], ["고객명", "name"], ["성함", "name"], ["이름", "name"],
    ["계약번호", "contractNo"],
    ["발행금액", "amount"], ["발행 금액", "amount"], ["금액", "amount"],
    ["사업자등록번호", "bizNo"], ["사업자번호", "bizNo"],
  ] as [string, Field][]
).sort((a, b) => b[0].length - a[0].length);

/** Teams 메시지 본문(HTML·멘션 태그 섞임)을 줄 단위 평문으로. */
export function plainText(input: string): string {
  return input
    .replace(/<at>[^<]*<\/at>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "");
}

function matchLabel(line: string): { field: Field; rest: string } | null {
  const compact = line.replace(/^[\s\-*•·]+/, "");
  for (const [label, field] of LABELS) {
    if (compact.startsWith(label)) {
      const rest = compact.slice(label.length);
      // "주소록" 같은 다른 낱말이 아니라 라벨 자체여야 한다: 뒤가 비었거나 구분자·공백
      if (rest === "" || /^[\s:：\-=)]/.test(rest)) return { field, rest: rest.replace(/^[\s:：\-=)]+/, "").trim() };
    }
  }
  return null;
}

const PHONE_RE = /(01[016789])[-.\s]?(\d{3,4})[-.\s]?(\d{4})/;

export function parseCashReceiptAsk(raw: string): CashReceiptAsk {
  const text = plainText(raw);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: Partial<Record<Field, string>> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = matchLabel(lines[i]);
    if (!m || out[m.field]) continue;
    let value = m.rest;
    if (!value && i + 1 < lines.length && !matchLabel(lines[i + 1])) {
      value = lines[i + 1];
      i++;
    }
    if (value) out[m.field] = value;
  }

  const flat = text.replace(/\s+/g, " ");
  const isRequest = /(현금\s*영수증|현영)/.test(flat) && /(신청|발행|요청|부탁|해\s*주세요|해주세요)/.test(flat);

  const phoneSrc = out.phone ?? flat;
  const pm = phoneSrc.match(PHONE_RE) ?? flat.match(PHONE_RE);
  const phone = pm ? pm[1] + pm[2] + pm[3] : undefined;

  const amountDigits = out.amount?.replace(/[^0-9]/g, "");
  let amount = amountDigits ? Number(amountDigits) : undefined;
  if (amount !== undefined && /만\s*원?/.test(out.amount ?? "") && amount < 100000) amount *= 10000;

  const biz = out.bizNo?.replace(/\D/g, "");
  const bizNo = biz && biz.length === 10 ? biz : undefined;
  const usage = bizNo || /지출\s*증빙/.test(flat) ? "expense" : "income";

  return {
    isRequest,
    address: out.address,
    name: out.name?.replace(/\s*(님|고객님)$/, "").trim() || undefined,
    phone,
    contractNo: out.contractNo?.match(/[A-Za-z]*\d{2}-\d{3,}/)?.[0]?.toUpperCase() ?? out.contractNo?.trim(),
    amount: amount && amount > 0 ? amount : undefined,
    bizNo,
    usage,
  };
}

/** 주소 속 "102동 1201호" → { dong: "102", ho: "1201" } */
export function dongHo(address: string | null | undefined): { dong?: string; ho?: string } {
  if (!address) return {};
  const dong = address.match(/(\d{1,4})\s*동(?![가-힣])/)?.[1];
  const ho = address.match(/(\d{1,5})\s*호/)?.[1];
  return { dong, ho };
}

/** 가리기: 홍길동 → 홍*동, 01012345678 → 010-****-5678, 사업자번호 → 123-45-*****. */
export function maskName(name: string | null | undefined): string {
  if (!name) return "";
  const n = name.trim();
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0] + "*";
  return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
}

export function maskIdentity(value: string | null | undefined): string {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length === 10 && !d.startsWith("01")) return `${d.slice(0, 3)}-${d.slice(3, 5)}-*****`;
  if (d.length >= 10) return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
  return d ? "*".repeat(Math.max(0, d.length - 4)) + d.slice(-4) : "";
}
