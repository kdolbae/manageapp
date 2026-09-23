"use client";

import { switchTenant } from "@/lib/actions/auth";

export function TenantSwitcher({
  tenants,
  currentId,
}: {
  tenants: { id: string; name: string }[];
  currentId: string;
}) {
  if (tenants.length <= 1) return <span className="text-[13px] font-semibold">{tenants[0]?.name}</span>;
  return (
    <form action={switchTenant}>
      <select
        name="tenant"
        defaultValue={currentId}
        className="field h-8 text-[13px] font-semibold pr-6"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="사업체 선택"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </form>
  );
}
