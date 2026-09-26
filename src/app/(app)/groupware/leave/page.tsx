import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todayKST, weekday } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { cancelLeave, createLeave, decideLeave, setLeaveGrant } from "@/lib/actions/groupware";
import { LEAVE_KIND, LEAVE_STATUS, addMonths, daysText, isValidMonth, monthLabel, monthRange } from "@/lib/groupware";
import { memberOptions } from "@/app/(app)/people/data";
import { FormButton } from "../ui";

export const metadata = { title: "휴가" };

type Balance = { granted: number; used: number };
type MyLeave = { id: string; kind: string; start_date: string; end_date: string; days: number; reason: string | null; status: string; comment: string | null; decided_at: string | null; decider: { display_name: string } | null };
type PendingLeave = { id: string; profile_id: string; kind: string; start_date: string; end_date: string; days: number; reason: string | null; created_at: string; requester: { display_name: string } | null };
type TeamLeave = { id: string; profile_id: string; kind: string; start_date: string; end_date: string; days: number; requester: { display_name: string } | null };
type Grant = { id: string; profile_id: string; year: number; days: number; memo: string | null; holder: { display_name: string } | null };
type MemberBalance = { profile_id: string; granted: number; used: number };

/** 기간 표시: 2026-10-06 (화) ~ 2026-10-07 (수) */
const periodText = (l: { start_date: string; end_date: string }) =>
  l.start_date === l.end_date ? `${l.start_date} (${weekday(l.start_date)})` : `${l.start_date} (${weekday(l.start_date)}) ~ ${l.end_date} (${weekday(l.end_date)})`;

export default async function LeavePage({ searchParams }: PageProps<"/groupware/leave">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const me = session.user.id;
  const sp = await searchParams;
  const today = todayKST();
  const year = Number(today.slice(0, 4));
  const month = isValidMonth(sp.m) ? sp.m : today.slice(0, 7);
  const { start, end } = monthRange(month);
  const canDecide = session.can("approval.decide");
  const canManage = session.can("member.manage");
  const supabase = await createClient();

  const [{ data: balance }, { data: mine }, { data: pendingRows }, { data: teamRows }, { data: grantRows }, { data: balanceRows }, members] = await Promise.all([
    supabase.from("leave_balance").select("granted, used").eq("tenant_id", tid).eq("profile_id", me).eq("year", year).maybeSingle(),
    supabase
      .from("leave_request")
      .select("id, kind, start_date, end_date, days, reason, status, comment, decided_at, decider:profile!leave_request_decided_by_fkey(display_name)")
      .eq("tenant_id", tid)
      .eq("profile_id", me)
      .order("start_date", { ascending: false })
      .limit(100),
    canDecide
      ? supabase
          .from("leave_request")
          .select("id, profile_id, kind, start_date, end_date, days, reason, created_at, requester:profile!leave_request_profile_id_fkey(display_name)")
          .eq("tenant_id", tid)
          .eq("status", "pending")
          .neq("profile_id", me)
          .order("start_date")
      : Promise.resolve({ data: [] as PendingLeave[] }),
    supabase
      .from("leave_request")
      .select("id, profile_id, kind, start_date, end_date, days, requester:profile!leave_request_profile_id_fkey(display_name)")
      .eq("tenant_id", tid)
      .eq("status", "approved")
      .lte("start_date", end)
      .gte("end_date", start)
      .order("start_date"),
    canManage
      ? supabase.from("leave_grant").select("id, profile_id, year, days, memo, holder:profile!leave_grant_profile_id_fkey(display_name)").eq("tenant_id", tid).eq("year", year).order("created_at")
      : Promise.resolve({ data: [] as Grant[] }),
    canManage ? supabase.from("leave_balance").select("profile_id, granted, used").eq("tenant_id", tid).eq("year", year) : Promise.resolve({ data: [] as MemberBalance[] }),
    canManage ? memberOptions(supabase, tid) : [],
  ]);
  const bal = (balance ?? null) as Balance | null;
  const remaining = bal ? Number(bal.granted) - Number(bal.used) : 0;
  const myList = (mine ?? []) as unknown as MyLeave[];
  const pendingList = (pendingRows ?? []) as unknown as PendingLeave[];
  const teamList = (teamRows ?? []) as unknown as TeamLeave[];
  const grants = (grantRows ?? []) as unknown as Grant[];
  const usedOf = new Map(((balanceRows ?? []) as MemberBalance[]).map((b) => [b.profile_id, Number(b.used)]));

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px] items-start">
      <div className="grid gap-4">
        <div className="card">
          <div className="panel-head">
            <h2>
              내 연차 <span className="sub">{year}년</span>
            </h2>
          </div>
          {bal ? (
            <div className="grid grid-cols-3">
              <div className="stat"><div className="k">부여</div><div className="v">{daysText(bal.granted)}</div></div>
              <div className="stat"><div className="k">사용(승인)</div><div className={`v ${Number(bal.used) ? "" : "zero"}`}>{daysText(bal.used)}</div></div>
              <div className="stat"><div className="k">잔여</div><div className={`v ${remaining < 0 ? "text-danger" : remaining ? "text-success" : "zero"}`}>{daysText(remaining)}</div></div>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted">부여된 연차가 없습니다. 병가·경조사·무급 휴가는 연차와 상관없이 신청할 수 있습니다.</p>
          )}
        </div>

        <div className="card overflow-x-auto">
          <div className="panel-head">
            <h2>
              내 휴가 신청 <span className="sub">{myList.length}건</span>
            </h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>종류</th>
                <th>기간</th>
                <th className="text-right">일수</th>
                <th>사유</th>
                <th>상태</th>
                <th>결재</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {myList.map((l) => {
                const st = LEAVE_STATUS[l.status] ?? { label: l.status, badge: "wait" as const };
                return (
                  <tr key={l.id}>
                    <td>{LEAVE_KIND[l.kind] ?? l.kind}</td>
                    <td className="mono text-xs whitespace-nowrap">{periodText(l)}</td>
                    <td className="num">{daysText(l.days)}</td>
                    <td className="text-xs text-muted max-w-[220px] truncate">{l.reason ?? ""}</td>
                    <td><span className={`badge badge-${st.badge}`}>{st.label}</span></td>
                    <td className="text-xs text-muted">
                      {l.decider?.display_name ?? ""}
                      {l.comment && <div className="whitespace-pre-wrap">{l.comment}</div>}
                    </td>
                    <td>
                      {l.status === "pending" && (
                        <ActionForm action={cancelLeave}>
                          <input type="hidden" name="id" value={l.id} />
                          <SubmitButton className="btn btn-sm btn-danger">취소</SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
              {myList.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted">신청한 휴가가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canDecide && (
          <div className="card overflow-x-auto">
            <div className="panel-head">
              <h2>
                결재 대기 <span className="sub">{pendingList.length}건</span>
              </h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>종류</th>
                  <th>기간</th>
                  <th className="text-right">일수</th>
                  <th>사유</th>
                  <th>결재</th>
                </tr>
              </thead>
              <tbody>
                {pendingList.map((l) => (
                  <tr key={l.id}>
                    <td className="font-semibold">{l.requester?.display_name ?? "—"}</td>
                    <td>{LEAVE_KIND[l.kind] ?? l.kind}</td>
                    <td className="mono text-xs whitespace-nowrap">{periodText(l)}</td>
                    <td className="num">{daysText(l.days)}</td>
                    <td className="text-xs text-muted max-w-[220px]">{l.reason ?? ""}</td>
                    <td>
                      <ActionForm action={decideLeave} className="flex flex-wrap items-center gap-1.5 min-w-[280px]">
                        <input type="hidden" name="id" value={l.id} />
                        <input name="comment" maxLength={500} placeholder="의견(선택)" className="field h-8 text-xs flex-1 min-w-[120px]" aria-label="의견" />
                        <FormButton name="decision" value="approved" className="btn btn-primary btn-sm">승인</FormButton>
                        <FormButton name="decision" value="rejected" className="btn btn-danger btn-sm">반려</FormButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
                {pendingList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-muted">결재 대기 중인 휴가가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="card overflow-x-auto">
          <div className="panel-head">
            <h2>
              이번 달 휴가 <span className="sub">{monthLabel(month)} · 승인된 것만</span>
            </h2>
            <div className="flex items-center gap-1">
              <Link href={`/groupware/leave?m=${addMonths(month, -1)}`} className="btn btn-sm" aria-label="이전 달">‹</Link>
              <Link href="/groupware/leave" className="btn btn-sm">이번 달</Link>
              <Link href={`/groupware/leave?m=${addMonths(month, 1)}`} className="btn btn-sm" aria-label="다음 달">›</Link>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>이름</th>
                <th>종류</th>
                <th>기간</th>
                <th className="text-right">일수</th>
              </tr>
            </thead>
            <tbody>
              {teamList.map((l) => (
                <tr key={l.id}>
                  <td className="font-semibold">{l.requester?.display_name ?? "—"}{l.profile_id === me && <span className="text-muted font-normal text-xs"> (나)</span>}</td>
                  <td>{LEAVE_KIND[l.kind] ?? l.kind}</td>
                  <td className="mono text-xs whitespace-nowrap">{periodText(l)}</td>
                  <td className="num">{daysText(l.days)}</td>
                </tr>
              ))}
              {teamList.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted">{monthLabel(month)}에 승인된 휴가가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canManage && (
          <div className="card overflow-x-auto">
            <div className="panel-head">
              <h2>
                연차 부여 현황 <span className="sub">{year}년 · {grants.length}명</span>
              </h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>이름</th>
                  <th className="text-right">부여</th>
                  <th className="text-right">사용</th>
                  <th className="text-right">잔여</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => {
                  const used = usedOf.get(g.profile_id) ?? 0;
                  return (
                    <tr key={g.id}>
                      <td className="font-semibold">{g.holder?.display_name ?? "—"}</td>
                      <td className="num">{daysText(g.days)}</td>
                      <td className={`num ${used ? "" : "zero"}`}>{daysText(used)}</td>
                      <td className="num">{daysText(Number(g.days) - used)}</td>
                      <td className="text-xs text-muted">{g.memo ?? ""}</td>
                    </tr>
                  );
                })}
                {grants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted">{year}년에 부여된 연차가 없습니다. 오른쪽에서 부여해 주세요.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4">
        <ActionForm action={createLeave} className="card p-4">
          <h2 className="text-sm font-semibold mb-1">휴가 신청</h2>
          <p className="text-xs text-muted mb-3">반차는 시작일 하루(0.5일), 그 외는 기간에서 토·일을 뺀 날 수로 계산합니다.</p>
          <div className="form-row">
            <label className="label" htmlFor="leave-kind">종류</label>
            <select id="leave-kind" name="kind" defaultValue="annual" className="field">
              {Object.entries(LEAVE_KIND).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-x-2">
            <div className="form-row">
              <label className="label" htmlFor="leave-start">시작<span className="req">*</span></label>
              <input id="leave-start" name="start_date" type="date" required defaultValue={today} className="field mono" />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="leave-end">끝 <span className="text-muted">(반차는 무시)</span></label>
              <input id="leave-end" name="end_date" type="date" className="field mono" />
            </div>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="leave-reason">사유</label>
            <textarea id="leave-reason" name="reason" rows={3} maxLength={500} className="field" />
          </div>
          <SubmitButton>신청</SubmitButton>
        </ActionForm>

        {canManage && (
          <ActionForm action={setLeaveGrant} className="card p-4">
            <h2 className="text-sm font-semibold mb-1">연차 부여</h2>
            <p className="text-xs text-muted mb-3">구성원·연도별로 한 번에 정합니다. 같은 연도에 다시 부여하면 덮어씁니다.</p>
            <div className="form-row">
              <label className="label" htmlFor="grant-member">구성원<span className="req">*</span></label>
              <select id="grant-member" name="profile_id" required className="field" defaultValue="">
                <option value="" disabled>선택</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-x-2">
              <div className="form-row">
                <label className="label" htmlFor="grant-year">연도</label>
                <input id="grant-year" name="year" type="number" min={2000} max={2100} defaultValue={year} className="field mono" />
              </div>
              <div className="form-row">
                <label className="label" htmlFor="grant-days">일수<span className="req">*</span></label>
                <input id="grant-days" name="days" type="number" step={0.5} min={0} max={365} required defaultValue={15} className="field mono" />
              </div>
            </div>
            <div className="form-row">
              <label className="label" htmlFor="grant-memo">메모</label>
              <input id="grant-memo" name="memo" maxLength={200} placeholder="예: 입사 2년차 15일 + 이월 1일" className="field" />
            </div>
            <SubmitButton className="btn">부여</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
