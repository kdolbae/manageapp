import type { Db } from "@/app/(app)/people/data";

/* 그룹웨어 화면들이 같이 쓰는 조회. 서버 컴포넌트에서만 부른다. */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 지금 볼 수 있는(만료 안 된) 공지 가운데 내가 아직 안 읽은 건수 */
export async function unreadNoticeCount(db: Db, tenantId: string, userId: string): Promise<number> {
  const now = new Date().toISOString();
  const [{ data: notices }, { data: reads }] = await Promise.all([
    db.from("notice").select("id").eq("tenant_id", tenantId).is("deleted_at", null).or(`expires_at.is.null,expires_at.gt.${now}`),
    db.from("notice_read").select("notice_id").eq("profile_id", userId),
  ]);
  const read = new Set(((reads ?? []) as { notice_id: string }[]).map((r) => r.notice_id));
  return ((notices ?? []) as { id: string }[]).filter((n) => !read.has(n.id)).length;
}

/** 내 결재 차례인 단계의 문서 id 목록. 상신자가 취소한 문서는 단계가 pending 으로 남으므로 결재 중인 문서만 센다. */
export async function myPendingDocIds(db: Db, tenantId: string, userId: string): Promise<string[]> {
  const { data } = await db
    .from("approval_step")
    .select("doc_id, doc:approval_doc!inner(status)")
    .eq("tenant_id", tenantId)
    .eq("approver_id", userId)
    .eq("status", "pending")
    .eq("doc.status", "submitted");
  return Array.from(new Set(((data ?? []) as unknown as { doc_id: string }[]).map((r) => r.doc_id)));
}
