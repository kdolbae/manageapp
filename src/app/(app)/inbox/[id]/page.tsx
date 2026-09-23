import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { phone } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { updateInquiry, addConsultation, convertInquiry } from "@/lib/actions/inbox";
import { INQUIRY_STATUS, INQUIRY_CHANNEL, CONSULT_CHANNEL, fmtDateTime } from "@/lib/inbox";
import { branchOptions, memberOptions, ensureOption } from "@/app/(app)/people/data";
import { appServiceLabel } from "@/lib/app-link";

export const metadata = { title: "문의" };

type Inquiry = {
  id: string; branch_id: string | null; channel: string; kind: string | null; name: string | null; phone: string | null; email: string | null; address: string | null; apt: string | null;
  message: string | null; source_page: string | null; utm: Record<string, string>; extra: Record<string, unknown>; attachments: { name?: string; url?: string }[];
  status: string; assigned_to: string | null; customer_id: string | null; contract_id: string | null; external_id: string | null;
  first_response_at: string | null; closed_at: string | null; created_at: string;
  assignee: { display_name: string } | null; customer: { id: string; name: string; phone: string | null } | null; contract: { id: string; contract_no: string } | null; branch: { name: string } | null;
};
type Consultation = { id: string; channel: string; direction: string; summary: string; next_action: string | null; next_action_at: string | null; created_at: string; actor: { display_name: string } | null };
type History = { id: number; from_status: string | null; to_status: string; at: string; actor_id: string | null };
type SamePhone = { id: string; name: string; phone: string | null };

const UTM_LABEL: Record<string, string> = { utm_source: "유입 매체", utm_medium: "유입 방식", utm_campaign: "캠페인", utm_term: "검색어", utm_content: "소재", referrer: "이전 페이지", gclid: "구글 광고 클릭", fbclid: "메타 광고 클릭" };

export default async function InquiryPage({ params }: PageProps<"/inbox/[id]">) {
  const { id } = await params;
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  if (!session.can("inquiry.read")) notFound();
  const supabase = await createClient();

  const { data } = await supabase
    .from("inquiry")
    .select("*, assignee:profile!inquiry_assigned_to_fkey(display_name), customer:customer(id, name, phone), contract:contract(id, contract_no), branch:branch(name)")
    .eq("id", id)
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  const inq = data as unknown as Inquiry;
  const digits = (inq.phone ?? "").replace(/\D/g, "");

  const [{ data: consults }, { data: history }, members, branches, { data: samePhone }] = await Promise.all([
    supabase.from("consultation").select("id, channel, direction, summary, next_action, next_action_at, created_at, actor:profile!consultation_actor_id_fkey(display_name)").eq("inquiry_id", id).order("created_at", { ascending: false }),
    supabase.from("status_history").select("id, from_status, to_status, at, actor_id").eq("entity", "inquiry").eq("entity_id", id).order("at", { ascending: false }).limit(30),
    memberOptions(supabase, tid),
    branchOptions(supabase, tid),
    digits.length >= 8 && !inq.customer_id && session.can("customer.read")
      ? supabase.from("customer").select("id, name, phone").eq("tenant_id", tid).eq("phone", digits).is("deleted_at", null).limit(5)
      : Promise.resolve({ data: [] as SamePhone[] }),
  ]);
  ensureOption(members, inq.assigned_to, inq.assignee?.display_name);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const consultations = (consults ?? []) as unknown as Consultation[];
  const hist = (history ?? []) as unknown as History[];
  const matches = (samePhone ?? []) as SamePhone[];
  const st = INQUIRY_STATUS[inq.status] ?? { label: inq.status, badge: "wait" as const };
  const canWrite = session.can("inquiry.write");
  const utm = Object.entries(inq.utm ?? {}).filter(([, v]) => v);
  const appHome = inq.channel === "app" ? appHomeFacts(inq.extra) : [];
  const me = session.profile?.display_name || session.user.email || "";
  const brand = (session.current.tenant.brand ?? {}) as Record<string, string | null>;
  const draft = `[${brand.app_name || session.current.tenant.name}] ${inq.name ?? "고객"}님, ${inq.kind ? `${inq.kind} ` : ""}문의 주셔서 감사합니다. 담당 ${me}입니다. 확인 후 곧 연락드리겠습니다. 급하시면 이 번호로 답장 주세요.`;
  const sms = digits ? `sms:${digits}?body=${encodeURIComponent(draft)}` : "";

  return (
    <div>
      <div className="panel-head">
        <h1>
          {inq.name ?? "이름 없음"} <span className="sub">{INQUIRY_CHANNEL[inq.channel] ?? inq.channel} 문의 · {fmtDateTime(inq.created_at)}</span>
          <span className={`badge badge-${st.badge} ml-2 align-middle`}>{st.label}</span>
        </h1>
        <Link href="/inbox" className="btn btn-sm">목록</Link>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
        <div className="grid gap-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {digits && <a href={`tel:${digits}`} className="btn btn-primary">전화 걸기 <span className="mono font-normal">{phone(inq.phone)}</span></a>}
              {sms && <a href={sms} className="btn">문자 보내기</a>}
              {inq.email && <a href={`mailto:${inq.email}`} className="btn">메일</a>}
              <CopyButton text={draft} label="답장 문구 복사" />
              {!digits && !inq.email && <span className="text-xs text-muted">연락처가 없는 문의입니다.</span>}
            </div>
            {inq.status === "new" && <p className="notice notice-danger mb-3">아직 응답 전입니다. 전화나 문자를 한 뒤 아래에 상담 기록을 남기면 &lsquo;연락함&rsquo;으로 바뀝니다.</p>}
            <h2 className="text-sm font-semibold mb-2">문의 내용</h2>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{inq.message || <span className="text-muted">내용 없음</span>}</p>
            <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 gap-x-3 text-sm mt-4">
              <dt className="text-muted">문의 종류</dt><dd>{inq.kind ?? "—"}</dd>
              <dt className="text-muted">단지</dt><dd>{inq.apt ?? "—"}</dd>
              <dt className="text-muted">주소</dt><dd>{inq.address ?? "—"}</dd>
              <dt className="text-muted">이메일</dt><dd className="mono">{inq.email ?? "—"}</dd>
              <dt className="text-muted">지점</dt><dd>{inq.branch?.name ?? "본사 공통"}</dd>
              {inq.source_page && <><dt className="text-muted">들어온 페이지</dt><dd className="mono text-xs break-all">{inq.source_page}</dd></>}
              {inq.first_response_at && <><dt className="text-muted">첫 응답</dt><dd>{fmtDateTime(inq.first_response_at)}</dd></>}
              {inq.external_id && <><dt className="text-muted">{inq.channel === "app" ? "앱 요청 번호" : "홈페이지 번호"}</dt><dd className="mono text-xs">{inq.external_id}</dd></>}
            </dl>
            {appHome.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-muted mb-1.5">앱에서 보낸 우리집 정보</h3>
                <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 gap-x-3 text-sm">
                  {appHome.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd>{v}</dd></Fragment>)}
                </dl>
              </div>
            )}
            {utm.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-muted mb-1.5">유입 경로 (마케팅)</h3>
                <div className="flex flex-wrap gap-1.5">{utm.map(([k, v]) => <span key={k} className="chip"><span className="text-muted mr-1">{UTM_LABEL[k] ?? k}</span>{String(v)}</span>)}</div>
              </div>
            )}
            {inq.attachments?.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-muted mb-1.5">첨부</h3>
                <ul className="text-sm">{inq.attachments.map((a, i) => <li key={i}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.name ?? a.url}</a> : a.name}</li>)}</ul>
              </div>
            )}
          </div>

          <div className="card">
            <div className="panel-head"><h2>상담 기록 <span className="sub">{consultations.length}건</span></h2></div>
            {canWrite && (
              <ActionForm action={addConsultation} className="p-4 border-b border-border">
                <input type="hidden" name="inquiry_id" value={inq.id} />
                {inq.customer_id && <input type="hidden" name="customer_id" value={inq.customer_id} />}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_2fr]">
                  <div className="form-row"><label className="label">방법</label><select name="channel" className="field" defaultValue="call">{Object.entries(CONSULT_CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div className="form-row"><label className="label">방향</label><select name="direction" className="field" defaultValue="out"><option value="out">내가 연락</option><option value="in">고객이 연락</option></select></div>
                  <div className="form-row"><label className="label">다음 할 일 (선택)</label><div className="flex gap-1.5"><input name="next_action" maxLength={200} placeholder="예: 견적서 보내기" className="field" /><input type="datetime-local" name="next_action_at" className="field w-[190px]" /></div></div>
                </div>
                <div className="form-row"><label className="label">상담 내용<span className="req">*</span></label><textarea name="summary" required maxLength={2000} rows={3} placeholder="통화 내용, 고객 요청, 견적 안내 등" className="field" /></div>
                <SubmitButton className="btn btn-primary btn-sm">기록 남기기</SubmitButton>
              </ActionForm>
            )}
            <ul className="divide-y divide-border">
              {consultations.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted mb-1">
                    <span className="mono">{fmtDateTime(c.created_at)}</span>
                    <span className="badge badge-wait">{CONSULT_CHANNEL[c.channel] ?? c.channel} · {c.direction === "in" ? "고객→우리" : "우리→고객"}</span>
                    <span>{c.actor?.display_name ?? ""}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{c.summary}</p>
                  {c.next_action && <p className="text-xs mt-1"><span className="text-muted">다음:</span> {c.next_action}{c.next_action_at && <span className="mono text-muted"> · {fmtDateTime(c.next_action_at)}</span>}</p>}
                </li>
              ))}
              {consultations.length === 0 && <li className="px-4 py-3 text-sm text-muted">아직 상담 기록이 없습니다.</li>}
            </ul>
          </div>

          {hist.length > 0 && (
            <div className="card">
              <div className="panel-head"><h2>상태 이력</h2></div>
              <table className="tbl">
                <tbody>
                  {hist.map((h) => (
                    <tr key={h.id}><td className="mono text-xs text-muted whitespace-nowrap">{fmtDateTime(h.at)}</td><td className="text-xs">{(h.from_status && INQUIRY_STATUS[h.from_status]?.label) ?? h.from_status ?? "—"} → <b>{INQUIRY_STATUS[h.to_status]?.label ?? h.to_status}</b></td><td className="text-xs text-muted">{(h.actor_id && nameOf.get(h.actor_id)) || "시스템"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid gap-4">
          <ActionForm action={updateInquiry} className="card p-4">
            <input type="hidden" name="id" value={inq.id} />
            <h2 className="text-sm font-semibold mb-3">처리</h2>
            <fieldset disabled={!canWrite} className="contents">
              <div className="form-row"><label className="label">상태</label><select name="status" defaultValue={inq.status} className="field">{Object.entries(INQUIRY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
              <div className="form-row"><label className="label">담당자</label><select name="assigned_to" defaultValue={inq.assigned_to ?? ""} className="field"><option value="">미정</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
              {branches.length > 1 && <div className="form-row"><label className="label">지점</label><select name="branch_id" defaultValue={inq.branch_id ?? ""} className="field"><option value="">본사 공통</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
              {canWrite && <SubmitButton className="btn btn-primary btn-sm">저장</SubmitButton>}
            </fieldset>
          </ActionForm>

          <div className="card p-4">
            <h2 className="text-sm font-semibold mb-2">고객·계약</h2>
            {inq.customer ? (
              <div className="text-sm">
                <p>고객 <Link href={`/people/customers/${inq.customer.id}`} className="font-semibold">{inq.customer.name}</Link> <span className="mono text-xs text-muted">{phone(inq.customer.phone)}</span></p>
                {inq.contract ? (
                  <p className="mt-1">계약 <Link href={`/contracts/${inq.contract.id}`} className="mono font-semibold">{inq.contract.contract_no}</Link></p>
                ) : (
                  session.can("contract.write") && <Link href={`/contracts/new?customer=${inq.customer.id}`} className="btn btn-primary btn-sm mt-3">이 고객으로 계약 등록</Link>
                )}
              </div>
            ) : canWrite && session.can("customer.write") ? (
              <div className="grid gap-3">
                {matches.length > 0 && (
                  <div>
                    <p className="text-xs text-muted mb-1.5">같은 전화번호의 고객이 이미 있습니다.</p>
                    {matches.map((m) => (
                      <ActionForm key={m.id} action={convertInquiry} className="flex items-center justify-between gap-2 py-1">
                        <input type="hidden" name="id" value={inq.id} /><input type="hidden" name="customer_id" value={m.id} /><input type="hidden" name="go" value="stay" />
                        <span className="text-sm">{m.name} <span className="mono text-xs text-muted">{phone(m.phone)}</span></span>
                        <SubmitButton className="btn btn-sm">이 고객과 연결</SubmitButton>
                      </ActionForm>
                    ))}
                  </div>
                )}
                <ActionForm action={convertInquiry} className="grid gap-2">
                  <input type="hidden" name="id" value={inq.id} />
                  <p className="text-xs text-muted">이름·전화·단지를 그대로 옮겨 새 고객으로 등록합니다. 문의 상태는 &lsquo;계약 전환&rsquo;이 됩니다.</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="submit" name="go" value="stay" className="btn btn-sm">고객으로 등록</button>
                    {session.can("contract.write") && <button type="submit" name="go" value="contract" className="btn btn-primary btn-sm">등록하고 계약 작성</button>}
                  </div>
                </ActionForm>
              </div>
            ) : (
              <p className="text-sm text-muted">아직 고객으로 등록되지 않았습니다.</p>
            )}
          </div>

          {canWrite && (
            <ActionForm action={updateInquiry} className="card p-4">
              <input type="hidden" name="id" value={inq.id} />
              <h2 className="text-sm font-semibold mb-3">문의 정보 수정</h2>
              <div className="form-row"><label className="label">이름</label><input name="name" defaultValue={inq.name ?? ""} maxLength={60} className="field" /></div>
              <div className="form-row"><label className="label">전화</label><input name="phone" defaultValue={phone(inq.phone)} maxLength={30} className="field mono" /></div>
              <div className="form-row"><label className="label">문의 종류</label><input name="kind" defaultValue={inq.kind ?? ""} maxLength={60} className="field" /></div>
              <div className="form-row"><label className="label">단지</label><input name="apt" defaultValue={inq.apt ?? ""} maxLength={100} className="field" /></div>
              <div className="form-row"><label className="label">주소</label><input name="address" defaultValue={inq.address ?? ""} maxLength={200} className="field" /></div>
              <SubmitButton className="btn btn-sm">저장</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </div>
  );
}

/** 집대리 앱 컨설팅 요청의 extra({ home, plan, via }) 를 사람이 읽는 항목으로. 사진·하자 내용은 앱이 보내지 않는다 */
function appHomeFacts(extra: Record<string, unknown>): [string, string][] {
  const home = (extra?.home ?? {}) as Record<string, unknown>;
  const plan = (extra?.plan ?? {}) as Record<string, unknown>;
  const out: [string, string][] = [];
  const add = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== "") out.push([k, String(v)]); };
  add("요청 방법", extra?.via === "kakao" ? "카카오톡" : extra?.via === "phone" ? "전화" : extra?.via);
  add("단지", home.name);
  add("지역", home.region);
  add("평형", typeof home.pyeong === "number" ? `${home.pyeong}평` : home.pyeong);
  add("욕실", typeof home.bathrooms === "number" ? `${home.bathrooms}개` : home.bathrooms);
  add("입주일", home.moveInDate);
  add("사전점검일", home.inspectionDate);
  if (Array.isArray(plan.serviceIds) && plan.serviceIds.length > 0) add("고른 시공", plan.serviceIds.map((id) => appServiceLabel(String(id))).join(", "));
  if (typeof plan.defectCount === "number" && plan.defectCount > 0) add("기록한 하자", `${plan.defectCount}건`);
  return out;
}
