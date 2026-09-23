import { Soon } from "@/components/soon";

export const metadata = { title: "자재·창고" };

export default function Page() {
  return <Soon title="자재·창고" day={9} items={["코팅제·비품·용품 품목과 단가", "창고(본사·지점·시공자 차량)별 재고", "입고·출고·이동·실사조정", "시공 건별 자재 사용"]} />;
}
