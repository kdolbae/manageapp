import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { deleteNotice, updateNotice } from "@/lib/actions/groupware";
import { isExpired, ymdKST } from "@/lib/groupware";
import { fmtDateTime } from "@/lib/inbox";
import { branchOptions, ensureOption } from "@/app/(app)/people/data";
import { UUID } from "../data";
import { MarkRead } from "./mark-read";

export const metadata = { title: "공지" };

type Notice = {
  id: string;
  title: string;
  body: string | null;
  branch_id: string | null;
  pinned: boolean;
  published_at: string;
  expires_at: string | null;
  attachments: { name?: string; url?: string }[];
  created_by: string | null;
  updated_at: string;
  author: { display_name: string } | null;
  branch: { name: string } | null;
};
type Read = { profile_id: string; read_at: string };
type Member = { profile_id: string; branch_id: string | null; scope: string; status: string; profile: { display_name: string; email: string | null } | null };

export default async function NoticePage({ params }: PageProps<"/groupware/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const me = session.user.id;
  const canWrite = session.can("notice.write");
  const supabase = await createClient();

  const { data } = await supabase
    .from("notice")
    .select("id, title, body, branch_id, pinned, published_at, expires_at, attachments, created_by, updated_at, author:profile(display_name), branch:branch(name)")
    .eq("id", id)
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  const n = data as unknown as Notice;

  const [{ data: reads }, branches, { data: members }] = await Promise.all([
    supabase.from("notice_read").select("profile_id, read_at").eq("notice_id", id).order("read_at"),
    canWrite ? branchOptions(supabase, tid) : [],
    canWrite ? supabase.from("membership").select("profile_id, branch_id, scope, status, profile:profile(display_name, email)").eq("tenant_id", tid).eq("status", "active") : Promise.resolve({ data: [] as Member[] }),
  ]);
  ensureOption(branches, n.branch_id, n.branch?.name);
  const readList = (reads ?? []) as Read[];
  const readByMe = readList.some((r) => r.profile_id === me);
  const memberList = (members ?? []) as unknown as Member[];
  const nameOf = new Map(memberList.map((m) => [m.profile_id, m.profile?.display_name || m.profile?.email || "(이름 없음)"]));
  // 이 공지를 볼 수 있는 구성원(전 지점 공지는 모두, 지점 공지는 그 지점과 사업체 범위 사용자)
  const audience = memberList.filter((m) => !n.branch_id || m.branch_id === n.branch_id || m.scope === "tenant" || m.scope === "group");
  const readIds = new Set(readList.map((r) => r.profile_id));
  const notRead = audience.filter((m) => !readIds.has(m.profile_id));
  const now = new Date().toISOString();
  const expired = isExpired(n.expires_at, now);
  const attachments = Array.isArray(n.attachments) ? n.attachments : [];

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
      {!readByMe && <MarkRead id={n.id} />}
      <div className="card p-4">
        <div className="text-xs text-muted mb-3">
          <Link href="/groupware">공지</Link>
          <span className="mx-1.5">/</span>
          <span className="text-text font-medium">{n.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold">{n.title}</h2>
          {n.pinned && <span className="badge badge-run">고정</span>}
          <span className="badge badge-wait">{n.branch?.name ?? "전 지점"}</span>
          {expired && <span className="badge badge-risk">만료</span>}
        </div>
        <div className="text-xs text-muted mb-4 flex flex-wrap gap-x-3 gap-y-1">
          <span>{n.author?.display_name ?? "작성자 없음"}</span>
          <span className="mono">게시 {fmtDateTime(n.published_at)}</span>
          {n.expires_at && <span className="mono">만료 {ymdKST(n.expires_at)}</span>}
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{n.body || <span className="text-muted">내용 없음</span>}</p>
        {attachments.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-muted mb-1.5">첨부</h3>
            <ul className="text-sm">
              {attachments.map((a, i) => (
                <li key={i}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.name ?? a.url}</a> : a.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid gap-4">
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">읽음</h2>
          <p className="text-sm">{readByMe ? <span className="badge badge-wait">읽음 표시됨</span> : <span className="badge badge-run">지금 읽음으로 표시합니다</span>}</p>
          {canWrite && (
            <div className="mt-3 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">읽은 사람</span>
                <span className="mono text-xs text-muted">{readList.length}명 / 대상 {audience.length}명</span>
              </div>
              <ul className="mt-1.5 divide-y divide-border text-xs">
                {readList.map((r) => (
                  <li key={r.profile_id} className="flex justify-between gap-2 py-1">
                    <span>{nameOf.get(r.profile_id) ?? "(다른 구성원)"}</span>
                    <span className="mono text-muted">{fmtDateTime(r.read_at)}</span>
                  </li>
                ))}
                {readList.length === 0 && <li className="py-1 text-muted">아직 아무도 읽지 않았습니다.</li>}
              </ul>
              {notRead.length > 0 && (
                <p className="text-xs text-muted mt-2">
                  아직 안 읽음: {notRead.map((m) => nameOf.get(m.profile_id)).join(", ")}
                </p>
              )}
            </div>
          )}
        </div>

        {canWrite && (
          <div className="card p-4">
            <details>
              <summary className="cursor-pointer text-sm text-accent">공지 수정</summary>
              <ActionForm action={updateNotice} className="mt-3">
                <input type="hidden" name="id" value={n.id} />
                <div className="form-row">
                  <label className="label" htmlFor="edit-title">제목<span className="req">*</span></label>
                  <input id="edit-title" name="title" required maxLength={120} defaultValue={n.title} className="field" />
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="edit-branch">대상</label>
                  <select id="edit-branch" name="branch_id" className="field" defaultValue={n.branch_id ?? ""}>
                    <option value="">전 지점</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-x-2">
                  <div className="form-row">
                    <label className="label" htmlFor="edit-expires">만료일</label>
                    <input id="edit-expires" name="expires_at" type="date" defaultValue={n.expires_at ? ymdKST(n.expires_at) : ""} className="field mono" />
                  </div>
                  <div className="form-row flex items-end pb-2.5">
                    <label className="chip">
                      <input type="checkbox" name="pinned" defaultChecked={n.pinned} /> 상단 고정
                    </label>
                  </div>
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="edit-body">내용</label>
                  <textarea id="edit-body" name="body" rows={8} maxLength={10000} defaultValue={n.body ?? ""} className="field" />
                </div>
                <SubmitButton className="btn btn-primary btn-sm">저장</SubmitButton>
              </ActionForm>
            </details>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-danger">공지 삭제…</summary>
              <p className="text-xs text-muted mt-2 mb-3">목록에서 사라집니다. 기록은 남습니다.</p>
              <form action={deleteNotice}>
                <input type="hidden" name="id" value={n.id} />
                <button className="btn btn-sm btn-danger">삭제 확정</button>
              </form>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
