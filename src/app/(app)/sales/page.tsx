import { Soon } from "@/components/soon";

export const metadata = { title: "영업 분석" };

export default function Page() {
  return <Soon title="영업 분석" day={8} items={["채널·상품·지점별 계약 추이", "유입 경로(광고·페이지)→문의→계약 전환율", "기간 비교"]} />;
}
