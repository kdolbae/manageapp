import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { SETTINGS_TABS, visible } from "@/lib/nav";

export default async function SettingsIndex() {
  const session = await requireTenant();
  const first = visible(SETTINGS_TABS, session.can)[0];
  redirect(first ? first.href : "/");
}
