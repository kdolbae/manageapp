import { Soon } from "@/components/soon";

export const metadata = { title: "오늘 시공" };

export default function Page() {
  return <Soon title="오늘 시공" day={6} items={["기사 본인의 오늘 시공 카드", "길 안내·시공 시작·완료", "잔금 수납 기록", "오프라인에서도 입력하고 나중에 전송"]} />;
}
