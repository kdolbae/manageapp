import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { phone } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createInquiry } from "@/lib/actions/inbox";
import { INQUIRY_STATUS, INQUIRY_CHANNEL, fmtDateTime, minutesSince } from "@/lib/inbox";

export const metadata = { title: "문의 인입함" };

type Row = { id: string; channel: string; kind: string | null; name: string | null; phone: string | null; apt: string | null; message: string | null; status: string; created_at: string; first_response_at: string | null; utm: Record<string, string>; assignee: { display_name: string } | null };

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "open";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const supabase = await createClient();
  if (!session.can("inquiry.read")) {
    return <div><div className="panel-head"><h1>문의 인입함</h1></div><p className="p-4 text-sm text-muted">문의 조회 권한이 없습니다.</p></div>;
  }
  let query = supabase.from("inquiry").select("id, channel, kind, name, phone, apt, message, status, created_at, first_response_at, utm, assignee:profile!inquiry_assigned_to_fkey(display_name)").eq("tenant_id", tid).is("deleted_at", null);
  if (status === "open") query = query.in("status", ["new", "contacted", "quoted"]);
  else if (status !== "all") query = query.eq("status", status);
  if (q) query = query.or(`name.ilike.%${q}%,phone.like.%${q.replace(/\D/g, "")}%,apt.ilike.%${q}%,message.ilike.%${q}%`);
  const [{ data: rows }, { count: newCount }, { data: branches }] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(200),
    supabase.from("inquiry").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "new").is("deleted_at", null),
    supabase.from("branch").select("id, name").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null),
  ]);
  const list = (rows ?? []) as unknown as Row[];
  const chips = [
    { key: "open", label: "처리 중" },
    { key: "new", label: "새 문의" },
    { key: "contacted", label: "연락함" },
    { key: "quoted", label: "견적 냄" },
    { key: "converted", label: "계약 전환" },
    { key: "closed", label: "종료" },
    { key: "spam", label: "스팸" },
    { key: "all", label: "전체" },
  ];

  return (
    <div>
      <div className="panel-head">
        <h1>문의 인입함 <span className="sub">새 문의 {newCount ?? 0}건</span></h1>
        <Link href="/settings/integrations" className="btn btn-sm">홈페이지·Teams 연결</Link>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 bg-bg border-b border-border">
        {chips.map((c) => <Link key={c.key} href={`/inbox?status=${c.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip ${status === c.key ? "is-active" : ""}`}>{c.label}</Link>)}
        <form method="get" className="ml-auto flex gap-1.5"><input type="hidden" name="status" value={status} /><input name="q" defaultValue={q} placeholder="이름·전화·단지·내용" className="field h-8 text-xs w-[200px]" /><button className="btn btn-sm">찾기</button></form>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_300px] items-start">
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>접수</th><th>경로</th><th>이름 · 연락처</th><th>문의</th><th>담당</th><th>상태</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const st = INQUIRY_STATUS[r.status] ?? { label: r.status, badge: "wait" as const };
                const waiting = r.status === "new" && minutesSince(r.created_at) > 60;
                return (
                  <tr key={r.id}>
                    <td className="mono text-xs text-muted whitespace-nowrap">{fmtDateTime(r.created_at)}{waiting && <div className="text-danger">1시간 넘게 미응답</div>}</td>
                    <td className="text-xs">{INQUIRY_CHANNEL[r.channel] ?? r.channel}{r.utm?.utm_source && <div className="text-muted">{r.utm.utm_source}</div>}</td>
                    <td><Link href={`/inbox/${r.id}`} className="font-semibold text-text no-underline">{r.name ?? "이름 없음"}</Link><div className="mono text-xs text-muted">{phone(r.phone)}</div></td>
                    <td className="text-xs max-w-[360px]"><span className="font-medium">{[r.kind, r.apt].filter(Boolean).join(" · ")}</span><div className="text-muted truncate">{r.message}</div></td>
                    <td className="text-xs">{r.assignee?.display_name ?? <span className="zero">—</span>}</td>
                    <td><span className={`badge badge-${st.badge}`}>{st.label}</span></td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={6} className="text-muted">문의가 없습니다. 홈페이지 폼을 연결하면 여기로 바로 들어옵니다.</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={6}>{list.length}건</td></tr></tfoot>
          </table>
        </div>
        {session.can("inquiry.write") && (
          <ActionForm action={createInquiry} className="card p-4">
            <h2 className="text-sm font-semibold mb-1">전화·방문 문의 직접 입력</h2>
            <p className="text-xs text-muted mb-3">홈페이지 문의는 자동으로 들어오고, 전화로 받은 문의는 여기서 남깁니다.</p>
            <div className="form-row"><label className="label">경로</label><select name="channel" className="field" defaultValue="phone">{Object.entries(INQUIRY_CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="form-row"><label className="label">이름</label><input name="name" maxLength={60} className="field" /></div>
            <div className="form-row"><label className="label">전화</label><input name="phone" maxLength={30} className="field mono" /></div>
            <div className="form-row"><label className="label">문의 종류</label><input name="kind" maxLength={60} placeholder="견적 / 시공 / AS" className="field" /></div>
            <div className="form-row"><label className="label">단지</label><input name="apt" maxLength={100} className="field" /></div>
            {(branches ?? []).length > 1 && <div className="form-row"><label className="label">지점</label><select name="branch_id" className="field" defaultValue={session.current.branch_id ?? ""}><option value="">본사 공통</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
            <div className="form-row"><label className="label">내용</label><textarea name="message" className="field" maxLength={4000} /></div>
            <SubmitButton>문의 등록</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
