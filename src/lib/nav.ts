export type NavItem = {
  href: string;
  label: string;
  icon: string; // lucide 아이콘 이름 (components/icons.tsx 에서 매핑)
  perm?: string | string[]; // 필요한 권한(배열이면 그중 하나, 없으면 누구나)
  day?: number; // 아직 안 만들어진 화면의 예정일 (있으면 메뉴에 D표시)
};

export type NavGroup = { title?: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    items: [
      { href: "/", label: "모니터링", icon: "gauge" },
      { href: "/inbox", label: "문의 인입함", icon: "inbox", perm: "inquiry.read" },
    ],
  },
  {
    title: "계약·시공",
    items: [
      { href: "/contracts", label: "계약 목록", icon: "file-text", perm: "contract.read" },
      { href: "/contracts/new", label: "계약 등록", icon: "file-plus", perm: "contract.write" },
      { href: "/assign", label: "시공 배정", icon: "calendar-check", perm: "job.assign" },
      { href: "/jobs", label: "시공 일정", icon: "wrench", perm: "job.read" },
      { href: "/ledger", label: "수납·환불", icon: "wallet", perm: "ledger.read" },
    ],
  },
  {
    title: "사람·상품",
    items: [
      { href: "/people", label: "고객·시공자·협력업체", icon: "users", perm: "customer.read" },
      { href: "/products", label: "상품·단가", icon: "package" },
      { href: "/inventory", label: "자재·창고", icon: "warehouse", perm: "inventory.read" },
    ],
  },
  {
    title: "영업·콘텐츠",
    items: [
      { href: "/content", label: "사진·후기·콘텐츠", icon: "image", perm: "content.read" },
      { href: "/sales", label: "영업 분석·캠페인", icon: "bar-chart", perm: ["report.read", "content.publish"] },
    ],
  },
  {
    title: "경영",
    items: [
      { href: "/finance", label: "경비·정산·재무", icon: "landmark", perm: ["finance.read", "expense.write", "expense.approve", "payout.read", "payout.approve"] },
      { href: "/groupware", label: "공지·결재·조직", icon: "building" },
      { href: "/settings", label: "설정", icon: "settings", perm: "member.manage" },
    ],
  },
];

/** 모바일 하단 탭 5개 */
export const MOBILE_TABS: NavItem[] = [
  { href: "/", label: "홈", icon: "gauge" },
  { href: "/jobs/today", label: "오늘시공", icon: "wrench", perm: "job.read" },
  { href: "/contracts", label: "계약", icon: "file-text", perm: "contract.read" },
  { href: "/ledger", label: "수납", icon: "wallet", perm: "ledger.read" },
  { href: "/menu", label: "더보기", icon: "menu" },
];

export const SETTINGS_TABS: NavItem[] = [
  { href: "/settings/tenant", label: "사업체", icon: "building", perm: "tenant.manage" },
  { href: "/settings/branches", label: "지점", icon: "map-pin", perm: "branch.manage" },
  { href: "/settings/members", label: "구성원", icon: "users", perm: "member.manage" },
  { href: "/settings/roles", label: "역할·권한", icon: "shield", perm: "member.manage" },
  { href: "/settings/integrations", label: "홈페이지·Teams 연동", icon: "settings", perm: "tenant.manage" },
];

export function visible(items: NavItem[], can: (p: string) => boolean) {
  return items.filter((i) => !i.perm || (Array.isArray(i.perm) ? i.perm.some(can) : can(i.perm)));
}
