import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { maskAccount, phone } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { updateTechnician } from "@/lib/actions/people";
import { branchOptions, ensureOption, memberOptions } from "../../data";
import { Crumb, KV, NoPermission, RATE_LABEL, StatusBadge, WorkAreaTags } from "../../shared";
import { TechnicianFields } from "../technician-fields";

export const metadata = { title: "시공자 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Technician = {
  id: string;
  name: string;
  phone: string | null;
  branch_id: string | null;
  profile_id: string | null;
  skills: string[] | null;
  vehicle_no: string | null;
  rate_type: string;
  bank_name: string | null;
  bank_account: string | null;
  bank_holder: string | null;
  hire_date: string | null;
  memo: string | null;
  status: string;
  created_at: string;
  branch: { name: string } | null;
  profile: { display_name: string; email: string | null } | null;
};

export default async function TechnicianPage({ params }: PageProps<"/people/technicians/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  if (!session.can("technician.read")) return <NoPermission what="시공자" />;
  const tid = session.current.tenant_id;
  const supabase = await createClient();

  const { data } = await supabase
    .from("technician")
    .select(
      "id, name, phone, branch_id, profile_id, skills, vehicle_no, rate_type, bank_name, bank_account, bank_holder, hire_date, memo, status, created_at, " +
        "branch:branch(name), profile:profile(display_name, email)",
    )
    .eq("id", id)
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  const t = data as unknown as Technician;
  const editable = session.can("technician.write");
  // 계좌는 정산 조회 권한자와 본인만 본다. 그 외에는 가려서 보여준다.
  const bankVisible = session.can("payout.read") || t.profile_id === session.user.id;

  const [areas, branches, members, { data: others }] = await Promise.all([
    codeValues(tid, "work_area"),
    editable ? branchOptions(supabase, tid) : [],
    editable ? memberOptions(supabase, tid, "technician") : [],
    supabase.from("technician").select("profile_id").eq("tenant_id", tid).is("deleted_at", null).not("profile_id", "is", null).neq("id", id),
  ]);
  const linked = new Set(((others ?? []) as { profile_id: string | null }[]).map((r) => r.profile_id).filter((p): p is string => !!p));
  ensureOption(branches, t.branch_id, t.branch?.name);
  ensureOption(members, t.profile_id, t.profile?.display_name);
  const skills = t.skills ?? [];
  const hasBank = Boolean(t.bank_name || t.bank_account || t.bank_holder);

  return (
    <div>
      <Crumb href="/people/technicians" parent="시공자" current={t.name} />
      <div className={"grid gap-4 items-start" + (editable ? " lg:grid-cols-[1fr_340px]" : " max-w-[720px]")}>
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="text-base font-semibold">{t.name}</h2>
            <StatusBadge status={t.status} />
            {t.profile && <span className="badge badge-run">앱 계정 연결</span>}
          </div>
          <KV k="전화">{t.phone ? <span className="mono">{phone(t.phone)}</span> : <span className="text-muted">—</span>}</KV>
          <KV k="지점">{t.branch?.name ?? "본사 공통"}</KV>
          <KV k="기술">
            <WorkAreaTags codes={skills} values={areas} />
          </KV>
          <KV k="정산 방식">{RATE_LABEL[t.rate_type] ?? t.rate_type}</KV>
          <KV k="차량">{t.vehicle_no ? <span className="mono">{t.vehicle_no}</span> : <span className="text-muted">—</span>}</KV>
          <KV k="입사일">{t.hire_date ? <span className="mono">{t.hire_date}</span> : <span className="text-muted">—</span>}</KV>
          <KV k="앱 계정">
            {t.profile ? (
              <>
                {t.profile.display_name}
                {t.profile.email && <span className="text-muted ml-2">{t.profile.email}</span>}
              </>
            ) : (
              <span className="text-muted">연결 안 됨</span>
            )}
          </KV>
          <KV k="정산 계좌">
            {!hasBank ? (
              <span className="text-muted">—</span>
            ) : bankVisible ? (
              <>
                {t.bank_name} <span className="mono">{t.bank_account}</span>
                {t.bank_holder && <span className="text-muted ml-2">예금주 {t.bank_holder}</span>}
              </>
            ) : (
              <>
                {t.bank_name} <span className="mono">{maskAccount(t.bank_account)}</span>
                <span className="text-muted text-xs ml-2">정산 조회 권한자와 본인만 전체를 볼 수 있습니다</span>
              </>
            )}
          </KV>
          <KV k="등록일">
            <span className="mono">{t.created_at.slice(0, 10)}</span>
          </KV>
          {t.memo && (
            <KV k="메모">
              <span className="whitespace-pre-wrap">{t.memo}</span>
            </KV>
          )}
        </div>

        {editable && (
          <ActionForm action={updateTechnician} className="card p-4">
            <h2 className="text-sm font-semibold mb-3">시공자 정보 수정</h2>
            <input type="hidden" name="id" value={t.id} />
            <TechnicianFields v={t} branches={branches} skills={areas} members={members} linked={linked} idPrefix="tech" />
            <div className="form-row">
              <label className="label" htmlFor="tech-status">상태</label>
              <select id="tech-status" name="status" defaultValue={t.status} className="field">
                <option value="active">활동</option>
                <option value="inactive">비활동</option>
              </select>
            </div>
            {bankVisible && (
              <fieldset className="border-t border-border pt-3 mt-1">
                <legend className="text-xs font-semibold text-muted px-1">정산 계좌</legend>
                <div className="grid grid-cols-2 gap-x-2">
                  <div className="form-row">
                    <label className="label" htmlFor="tech-bank">은행</label>
                    <input id="tech-bank" name="bank_name" maxLength={30} defaultValue={t.bank_name ?? ""} className="field" />
                  </div>
                  <div className="form-row">
                    <label className="label" htmlFor="tech-holder">예금주</label>
                    <input id="tech-holder" name="bank_holder" maxLength={40} defaultValue={t.bank_holder ?? ""} className="field" />
                  </div>
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="tech-account">계좌번호</label>
                  <input id="tech-account" name="bank_account" maxLength={40} defaultValue={t.bank_account ?? ""} className="field mono" />
                </div>
              </fieldset>
            )}
            <SubmitButton>저장</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
