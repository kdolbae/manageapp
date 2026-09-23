import { Soon } from "@/components/soon";

export const metadata = { title: "계약 등록" };

export default function Page() {
  return <Soon title="계약 등록" day={3} items={["계약자(고객) 검색·등록과 현장 주소", "상품·옵션 선택으로 품목과 금액 자동 계산", "시공 건(작업 단위별 날짜·담당) 추가", "협력업체 발주 건 표시"]} />;
}
