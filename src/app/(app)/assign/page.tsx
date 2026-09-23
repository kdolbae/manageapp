import { Soon } from "@/components/soon";

export const metadata = { title: "시공 배정" };

export default function Page() {
  return <Soon title="시공 배정" day={5} items={["날짜×기사 배정 보드", "일자별 시공 캐파와 초과 경고", "미배정 시공 건 목록", "기사에게 배정 알림"]} />;
}
