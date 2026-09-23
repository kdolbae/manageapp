import { Soon } from "@/components/soon";

export const metadata = { title: "시공 일정" };

export default function Page() {
  return <Soon title="시공 일정" day={5} items={["기사별·지점별 시공 일정", "상태(예정·배정·완료·연기·취소) 바꾸기", "시공 사진과 완료 확인"]} />;
}
