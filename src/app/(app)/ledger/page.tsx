import { Soon } from "@/components/soon";

export const metadata = { title: "수납·환불" };

export default function Page() {
  return <Soon title="수납·환불" day={4} items={["계약금·중도금·잔금·환불·매출취소 원장", "잔액은 원장에서 계산", "결제수단별 집계", "원장 취소는 삭제가 아니라 취소 기록"]} />;
}
