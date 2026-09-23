import { Soon } from "@/components/soon";

export const metadata = { title: "공지·결재·조직" };

export default function Page() {
  return <Soon title="공지·결재·조직" day={9} items={["공지사항", "결재(상신·승인·반려) 공통 엔진", "조직도·휴가"]} />;
}
