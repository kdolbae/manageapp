export type NavItem = {
  href: string;
  label: string;
  icon: string; // lucide 아이콘 이름 (components/icons.tsx 에서 매핑)
  perm?: string; // 필요한 권한(없으면 누구나)
  day?: number; // 아직 안 만들어진 화면의 예정일 (D1~D12)
};

export type NavGroup = { title?: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    items: [
      { href: "/", label: "모니터링", icon: "gauge", day: 8 },
      { href: "/inbox", label: "문의 인입함", icon: "inbox", perm: "inquiry.read", day: 7 },
    ],
  },
  {
    title: "계약·시공",
    items: [
      { href: "/contracts", label: "계약 목록", icon: "file-text", perm: "contract.read", day: 3 },
      { href: "/contracts/new", label: "계약 등록", icon: "file-plus", perm: "contract.write", day: 3 },
      { href: "/assign", label: "시공 배정", icon: "calendar-check", perm: "job.assign", day: 5 },
      { href: "/jobs", label: "시공 일정", icon: "wrench", perm: "job.read", day: 5 },
      { href: "/ledger", label: "수납·환불", icon: "wallet", perm: "ledger.read", day: 4 },
    ],
  },
  {
    title: "사람·상품",
    items: [
      { href: "/people", label: "고객·시공자·협력업체", icon: "users", perm: "customer.read", day: 2 },
      { href: "/products", label: "상품·단가", icon: "package", perm: "product.manage", day: 2 },
      { href: "/inventory", label: "자재·창고", icon: "warehouse", perm: "inventory.read", day: 9 },
    ],
  },
  {
    title: "영업·콘텐츠",
    items: [
      { href: "/content", label: "사진·후기·콘텐츠", icon: "image", perm: "content.read", day: 7 },
      { href: "/sales", label: "영업 분석", icon: "bar-chart", perm: "report.read", day: 8 },
    ],
  },
  {
    title: "경영",
    items: [
      { href: "/finance", label: "경비·정산·재무", icon: "landmark", perm: "finance.read", day: 8 },
      { href: "/groupware", label: "공지·결재·조직", icon: "building", day: 9 },
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
];

export function visible(items: NavItem[], can: (p: string) => boolean) {
  return items.filter((i) => !i.perm || can(i.perm));
}
