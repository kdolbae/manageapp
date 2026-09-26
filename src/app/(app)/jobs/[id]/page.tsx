import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { phone, won, shortDate } from "@/lib/format";
import { weekday } from "@/lib/dates";
import { JOB_STATUS, JOB_KIND, TIME_SLOT, workAreaClass } from "@/lib/contracts";
import { MEDIA_KIND, signedUrlMap } from "@/lib/media";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PhotoUploader } from "@/components/photo-uploader";
import { deleteMedia, updateMedia } from "@/lib/actions/media";
import { Thumb } from "@/app/(app)/content/media-ui";

export const metadata = { title: "시공 건" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Job = {
  id: string;
  contract_id: string;
  branch_id: string | null;
  work_area_code: string | null;
  kind: string;
  status: string;
  scheduled_date: string | null;
  time_slot: string;
  scheduled_time: string | null;
  technician_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  memo: string | null;
  contract_no: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  site_id: string | null;
  site_name: string | null;
  site_unit: string | null;
  sale_total: number;
  paid_total: number;
  balance: number;
  approval_status: string;
  technician_name: string | null;
};
type Photo = {
  id: string;
  kind: string;
  path: string;
  caption: string | null;
  marketing_ok: boolean;
  tags: string[];
  taken_at: string | null;
  created_at: string;
  uploader: { display_name: string } | null;
};

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const supabase = await createClient();

  // RLS 가 거른 시공 건(다른 지점·다른 기사)은 없는 것으로 보인다
  const { data: row } = await supabase.from("job_summary").select("*").eq("id", id).eq("tenant_id", tid).maybeSingle();
  if (!row) notFound();
  const job = row as Job;

  const [{ data: photos }, workAreas, { data: site }] = await Promise.all([
    supabase
      .from("media_asset")
      .select("id, kind, path, caption, marketing_ok, tags, taken_at, created_at, uploader:profile(display_name)")
      .eq("job_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    codeValues(tid, "work_area"),
    job.site_id ? supabase.from("site").select("address").eq("id", job.site_id).maybeSingle() : Promise.resolve({ data: null as { address: string | null } | null }),
  ]);
  const list = (photos ?? []) as unknown as Photo[];
  const urls = await signedUrlMap(supabase, list.map((p) => p.path));
  const groups = Object.entries(MEDIA_KIND).map(([kind, label]) => ({ kind, label, items: list.filter((p) => p.kind === kind) })).filter((g) => g.items.length > 0);

  const js = JOB_STATUS[job.status] ?? { label: job.status, badge: "wait" as const };
  const waIndex = workAreas.findIndex((w) => w.code === job.work_area_code);
  const wa = waIndex >= 0 ? { ...workAreas[waIndex], cls: workAreaClass(workAreas[waIndex].color, waIndex) } : null;
  const canWrite = session.can("content.write");
  const canPublish = session.can("content.publish");
  const address = site?.address ?? null;

  return (
    <div>
      <div className="panel-head flex-wrap">
        <h1>
          <Link href={`/contracts/${job.contract_id}`} className="mono">{job.contract_no}</Link>
          <span className="inline-flex items-center gap-1.5">
            {wa && <span className={`mark mark-${wa.cls}`}>{wa.label.slice(0, 1)}</span>}
            {wa?.label ?? "전체"} {JOB_KIND[job.kind] ?? job.kind}
          </span>
          <span className={`badge badge-${js.badge}`}>{js.label}</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link href={`/contracts/${job.contract_id}`} className="btn btn-sm">계약</Link>
          <Link href={job.scheduled_date ? `/jobs/today?date=${job.scheduled_date}` : "/jobs"} className="btn btn-sm">시공 일정</Link>
        </div>
      </div>

      <div className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <aside className="grid gap-4 min-w-0 lg:order-2">
          <section className="card p-4 text-sm grid gap-2">
            <h2 className="text-sm font-semibold">시공 정보</h2>
            <div className="grid grid-cols-[72px_1fr] gap-y-1.5 gap-x-2">
              <span className="text-muted">고객</span>
              <span>
                <Link href={`/people/customers/${job.customer_id}`} className="font-semibold">{job.customer_name ?? "—"}</Link>
                {job.customer_phone && <a href={`tel:${job.customer_phone}`} className="mono ml-2">{phone(job.customer_phone)}</a>}
              </span>
              <span className="text-muted">현장</span>
              <span>
                {[job.site_name, job.site_unit].filter(Boolean).join(" ") || "—"}
                {address && <div className="text-xs text-muted">{address}</div>}
              </span>
              <span className="text-muted">예정</span>
              <span className="mono">
                {job.scheduled_date ? `${job.scheduled_date} (${weekday(job.scheduled_date)}) ${job.time_slot !== "any" ? TIME_SLOT[job.time_slot] : ""}` : <span className="text-muted">미정</span>}
              </span>
              <span className="text-muted">담당</span>
              <span>{job.technician_name ?? <span className="text-muted">미배정</span>}</span>
              <span className="text-muted">계약 잔액</span>
              <span className={`mono ${Number(job.balance) > 0 ? "text-danger font-semibold" : "text-muted"}`}>{Number(job.balance) > 0 ? won(job.balance) : "수납 완료"}</span>
              {job.completed_at && (
                <>
                  <span className="text-muted">완료</span>
                  <span className="mono">{shortDate(job.completed_at)}</span>
                </>
              )}
              {job.memo && (
                <>
                  <span className="text-muted">메모</span>
                  <span className="whitespace-pre-wrap">{job.memo}</span>
                </>
              )}
            </div>
          </section>
          {canWrite && <PhotoUploader tenantId={tid} jobId={job.id} contractId={job.contract_id} defaultKind={job.status === "done" || job.status === "in_progress" ? "after" : "before"} />}
        </aside>

        <div className="grid gap-4 min-w-0 lg:order-1">
          {groups.map((g) => (
            <section key={g.kind} className="card">
              <div className="panel-head">
                <h2>
                  {g.label} <span className="sub">{g.items.length}장</span>
                </h2>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {g.items.map((p) => {
                  const url = urls.get(p.path);
                  const alt = p.caption ?? g.label;
                  return (
                    <div key={p.id} className="card overflow-hidden">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer"><Thumb src={url} alt={alt} /></a>
                      ) : (
                        <Thumb src={undefined} alt={alt} />
                      )}
                      <div className="p-2 grid gap-1 text-xs">
                        <div className="flex items-center justify-between gap-1">
                          <span className="mono text-muted">{shortDate(p.taken_at ?? p.created_at)}</span>
                          {p.marketing_ok && <span className="badge badge-done">마케팅</span>}
                        </div>
                        {p.caption && <div className="truncate" title={p.caption}>{p.caption}</div>}
                        {p.tags?.length > 0 && <div className="text-muted truncate">{p.tags.map((t) => `#${t}`).join(" ")}</div>}
                        {p.uploader?.display_name && <div className="text-muted">{p.uploader.display_name}</div>}
                        {canWrite && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-accent">수정</summary>
                            <ActionForm action={updateMedia} className="mt-2 grid gap-2">
                              <input type="hidden" name="id" value={p.id} />
                              <input name="caption" defaultValue={p.caption ?? ""} placeholder="설명" className="field" aria-label="설명" maxLength={300} />
                              <select name="kind" defaultValue={p.kind} className="field" aria-label="종류">
                                {Object.entries(MEDIA_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                              <input name="tags" defaultValue={(p.tags ?? []).join(", ")} placeholder="태그 (쉼표로 구분)" className="field" aria-label="태그" maxLength={500} />
                              {canPublish && (
                                <label className="flex items-center gap-2 text-xs">
                                  <input type="hidden" name="set_marketing" value="1" />
                                  <input type="checkbox" name="marketing_ok" defaultChecked={p.marketing_ok} className="w-4 h-4" />
                                  마케팅 사용 가능 (고객 동의 확인됨)
                                </label>
                              )}
                              <SubmitButton className="btn btn-sm">저장</SubmitButton>
                            </ActionForm>
                            <details className="mt-2">
                              <summary className="cursor-pointer text-danger">삭제</summary>
                              <form action={deleteMedia} className="mt-2 grid gap-2">
                                <input type="hidden" name="id" value={p.id} />
                                <p className="text-muted">이 사진을 지웁니다. 화면에서 사라지며 되돌릴 수 없습니다.</p>
                                <button className="btn btn-sm btn-danger">삭제 확인</button>
                              </form>
                            </details>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {list.length === 0 && (
            <div className="card p-8 text-center text-sm text-muted">
              아직 사진이 없습니다.{canWrite ? " 시공 전·후 사진을 올려 주세요." : ""}
            </div>
          )}
          {list.length > 0 && <div className="mono text-xs text-muted">{list.length}장</div>}
        </div>
      </div>
    </div>
  );
}
