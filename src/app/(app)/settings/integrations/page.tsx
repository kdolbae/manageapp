import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/origin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { saveTeamsWebhook, testTeamsWebhook, rotateWebInquiryKey } from "@/lib/actions/inbox";
import { fmtDateTime } from "@/lib/inbox";

export const metadata = { title: "연동 설정" };

type Config = { kind: string; config: Record<string, string | undefined>; is_active: boolean; updated_at: string };
type OutboxRow = { id: string; channel: string; template: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null };

const OUTBOX_STATUS: Record<string, { label: string; badge: string }> = { pending: { label: "대기", badge: "wait" }, sent: { label: "보냄", badge: "done" }, failed: { label: "실패", badge: "risk" }, skipped: { label: "건너뜀", badge: "wait" } };

export default async function IntegrationsPage() {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  if (!session.can("tenant.manage")) {
    return <p className="text-sm text-muted">연동 설정은 대표만 볼 수 있습니다.</p>;
  }
  const supabase = await createClient();
  const [{ data: configs }, { data: outbox }] = await Promise.all([
    supabase.from("integration_config").select("kind, config, is_active, updated_at").eq("tenant_id", tid),
    supabase.from("notification_outbox").select("id, channel, template, status, attempts, last_error, created_at, sent_at").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(20),
  ]);
  const byKind = new Map(((configs ?? []) as Config[]).map((c) => [c.kind, c]));
  const teams = byKind.get("teams_webhook");
  const web = byKind.get("web_inquiry");
  const rows = (outbox ?? []) as OutboxRow[];
  const origin = await siteOrigin();
  const endpoint = `${origin}/api/public/inquiry`;
  const sample = `fetch("${endpoint}", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": "<발급받은 키>" },
  body: JSON.stringify({
    name, phone, email, apt, address, kind, message,
    source_page: location.href,
    utm: { utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer: document.referrer },
    external_id: "<홈페이지 문의 id, 중복 방지용>",
    website: "" // 허니팟: 봇이 채우면 무시됩니다
  })
});`;

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <div className="grid gap-4">
        <ActionForm action={saveTeamsWebhook} className="card p-4">
          <h2 className="text-sm font-semibold mb-1">Teams 알림</h2>
          <p className="text-xs text-muted mb-3">새 문의가 들어오면 Teams 채널에 카드를 보냅니다. Teams 에서 워크플로 &lsquo;웹후크 요청을 받으면 채널에 게시&rsquo; 를 만들고 그 주소를 붙여 넣으세요.</p>
          <div className="form-row">
            <label className="label" htmlFor="url">워크플로 웹훅 주소</label>
            <input id="url" name="url" type="url" defaultValue={teams?.config.url ?? ""} placeholder="https://prod-00.koreacentral.logic.azure.com:443/workflows/..." className="field mono text-xs" />
          </div>
          <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" name="is_active" defaultChecked={teams?.is_active ?? true} /> 알림 켜기</label>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton className="btn btn-primary btn-sm">저장</SubmitButton>
            {teams?.updated_at && <span className="text-xs text-muted">마지막 저장 {fmtDateTime(teams.updated_at)}</span>}
          </div>
        </ActionForm>
        {teams?.config.url && (
          <ActionForm action={testTeamsWebhook} className="card p-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">채널로 확인 메시지 보내기</span>
            <SubmitButton className="btn btn-sm" pendingText="보내는 중…">테스트 보내기</SubmitButton>
          </ActionForm>
        )}

        <div className="card">
          <div className="panel-head"><h2>최근 발송 <span className="sub">20건</span></h2></div>
          <table className="tbl">
            <thead><tr><th>시각</th><th>채널</th><th>내용</th><th>상태</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const s = OUTBOX_STATUS[r.status] ?? { label: r.status, badge: "wait" };
                return (
                  <tr key={r.id}>
                    <td className="mono text-xs text-muted whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className="text-xs">{r.channel === "teams" ? "Teams" : r.channel}</td>
                    <td className="text-xs">{r.template === "inquiry.new" ? "새 문의" : r.template}{r.last_error && <div className="text-danger truncate max-w-[260px]" title={r.last_error}>{r.last_error}</div>}</td>
                    <td><span className={`badge badge-${s.badge}`}>{s.label}</span>{r.attempts > 1 && <span className="text-xs text-muted ml-1">{r.attempts}회</span>}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={4} className="text-muted">아직 보낸 알림이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">홈페이지 문의 받기</h2>
          <p className="text-xs text-muted mb-3">홈페이지 문의 폼이 아래 주소로 보내면 문의 인입함에 바로 들어오고 알림이 갑니다. 키는 서버에 해시로만 저장되어 발급 순간 한 번만 보입니다.</p>
          <div className="form-row">
            <label className="label">문의 받는 주소</label>
            <div className="flex gap-1.5"><div className="field mono text-xs flex items-center bg-bg text-muted break-all">{endpoint}</div><CopyButton text={endpoint} /></div>
          </div>
          <div className="form-row">
            <label className="label">API 키</label>
            <div className="text-sm">
              {web ? <>발급됨 <span className="mono text-xs">{web.config.key_hint}…</span> <span className="text-xs text-muted">({web.config.rotated_at ? fmtDateTime(web.config.rotated_at) : ""})</span></> : <span className="text-muted">아직 발급 전</span>}
            </div>
          </div>
          <ActionForm action={rotateWebInquiryKey}>
            <SubmitButton className={web ? "btn btn-sm" : "btn btn-primary btn-sm"}>{web ? "키 다시 발급 (이전 키는 바로 무효)" : "키 발급"}</SubmitButton>
          </ActionForm>
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">홈페이지에 붙이는 방법</h2>
          <p className="text-xs text-muted mb-2">문의 폼 제출 뒤 서버(또는 서버리스 함수)에서 아래처럼 호출합니다. 키는 브라우저에 두지 말고 홈페이지 서버 환경변수에 넣으세요. 이름·전화·내용 중 하나는 있어야 합니다.</p>
          <pre className="mono text-[11px] leading-relaxed bg-bg border border-border rounded p-3 overflow-x-auto whitespace-pre">{sample}</pre>
          <div className="mt-2"><CopyButton text={sample} label="코드 복사" /></div>
          <ul className="text-xs text-muted mt-3 list-disc pl-4 space-y-1">
            <li>같은 external_id 로 두 번 보내면 한 번만 들어옵니다.</li>
            <li>utm 값을 같이 보내면 문의마다 어느 광고·검색어에서 왔는지 남습니다.</li>
            <li>응답: 200 {"{ ok: true, id }"} · 401 키 오류 · 422 필수값 없음.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
