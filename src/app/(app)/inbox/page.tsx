import { Soon } from "@/components/soon";

export const metadata = { title: "문의 인입함" };

export default function Page() {
  return <Soon title="문의 인입함" day={7} items={["홈페이지 문의가 들어오면 실시간 알림", "전화·문자·알림톡 초안으로 바로 연락", "상담 기록과 담당자 지정", "계약으로 전환"]} />;
}
