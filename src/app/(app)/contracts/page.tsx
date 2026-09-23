import { Soon } from "@/components/soon";

export const metadata = { title: "계약 목록" };

export default function Page() {
  return <Soon title="계약 목록" day={4} items={["계약자·현장·계약일·작업 단위별 기사와 예정일", "계약금액·입금·잔액과 시공 상태", "집계 6칸과 필터 칩", "지점·기간·상태로 걸러 보기"]} />;
}
