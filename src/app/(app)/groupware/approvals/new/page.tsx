import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/action-form";
import { createApproval } from "@/lib/actions/groupware";
import { memberOptions } from "@/app/(app)/people/data";
import { FormButton } from "../../ui";
import { ApprovalFields, EMPTY_APPROVAL } from "../approval-fields";

export const metadata = { title: "결재 올리기" };

export default async function NewApprovalPage() {
  const session = await requireTenant();
  if (!session.can("approval.write")) redirect("/groupware/approvals");
  const supabase = await createClient();
  const members = (await memberOptions(supabase, session.current.tenant_id)).filter((m) => m.id !== session.user.id);

  return (
    <div className="p-4 max-w-[860px]">
      <div className="card">
        <div className="panel-head">
          <h2>결재 올리기</h2>
          <Link href="/groupware/approvals" className="btn btn-sm">목록</Link>
        </div>
        <ActionForm action={createApproval} className="p-4">
          <ApprovalFields values={EMPTY_APPROVAL} members={members} idPrefix="ap-new" />
          {members.length === 0 && <p className="notice mb-3">결재를 받을 다른 구성원이 없습니다. 설정 &gt; 구성원에서 먼저 초대해 주세요.</p>}
          <div className="flex flex-wrap gap-2 mt-1">
            <FormButton name="mode" value="draft" className="btn">임시 저장</FormButton>
            <FormButton name="mode" value="submit" className="btn btn-primary">상신</FormButton>
            <Link href="/groupware/approvals" className="btn">취소</Link>
          </div>
          <p className="text-xs text-muted mt-3">임시 저장하면 작성 중 상태로 남고, 상신하면 1단계 결재자에게 바로 알림이 갑니다. 상신한 뒤에는 내용을 고칠 수 없고 취소만 할 수 있습니다.</p>
        </ActionForm>
      </div>
    </div>
  );
}
