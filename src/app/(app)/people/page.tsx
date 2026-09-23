import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { visible } from "@/lib/nav";
import { PEOPLE_TABS } from "./tabs";

export default async function PeopleIndex() {
  const session = await requireTenant();
  const first = visible(PEOPLE_TABS, session.can)[0];
  redirect(first ? first.href : "/");
}
