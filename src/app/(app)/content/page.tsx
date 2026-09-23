import { Soon } from "@/components/soon";

export const metadata = { title: "사진·후기·콘텐츠" };

export default function Page() {
  return <Soon title="사진·후기·콘텐츠" day={7} items={["시공 사진과 후기를 한곳에", "사진·후기로 콘텐츠 초안 만들기(AI)", "발행 채널별 정리"]} />;
}
