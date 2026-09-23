import { Soon } from "@/components/soon";

export const metadata = { title: "고객·시공자·협력업체" };

export default function Page() {
  return <Soon title="고객·시공자·협력업체" day={2} items={["고객 등록과 계약 이력", "시공자(기사) 등록·지점·기술 단가", "협력업체(발주처·외주·공급사·주관사·소개처)"]} />;
}
