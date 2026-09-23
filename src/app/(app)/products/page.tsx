import { Soon } from "@/components/soon";

export const metadata = { title: "상품·단가" };

export default function Page() {
  return <Soon title="상품·단가" day={2} items={["상품 카테고리·상품·옵션·패키지", "가격 규칙(기간·지점·협력업체별)", "기사 단가표"]} />;
}
