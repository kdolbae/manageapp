import type { NavItem } from "@/lib/nav";

/** 사람 화면의 하위 탭. 조회 권한이 있는 탭만 보인다(`visible()` 로 거른다). */
export const PEOPLE_TABS: NavItem[] = [
  { href: "/people/customers", label: "고객", icon: "users", perm: "customer.read" },
  { href: "/people/technicians", label: "시공자", icon: "wrench", perm: "technician.read" },
  { href: "/people/partners", label: "협력업체", icon: "building", perm: "partner.read" },
];
