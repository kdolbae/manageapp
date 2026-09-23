import { Soon } from "@/components/soon";

export const metadata = { title: "경비·정산·재무" };

export default function Page() {
  return <Soon title="경비·정산·재무" day={8} items={["경비 청구·결재", "기사 정산 명세", "계정 매핑과 월 손익 요약"]} />;
}
