import { createClient } from "@/lib/supabase/server";

export type CodeValue = { code: string; label: string; color: string | null; sort_order: number };

/** 사업체 코드값(작업 단위·유입 경로 등) 한 도메인 조회. */
export async function codeValues(tenantId: string, domain: string): Promise<CodeValue[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("code_value")
    .select("code, label, color, sort_order")
    .eq("tenant_id", tenantId)
    .eq("domain", domain)
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as CodeValue[];
}

export function labelOf(codes: CodeValue[], code: string | null | undefined) {
  if (!code) return "";
  return codes.find((c) => c.code === code)?.label ?? code;
}
