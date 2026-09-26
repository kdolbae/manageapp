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
  const priceStats = `${origin}/api/public/v1/price-stats?slug=${session.current.tenant.slug}`;
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
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1">집대리 앱 연결</h2>
          <p className="text-xs text-muted mb-3">입주 준비 앱(집대리)과 세 가지가 이어집니다. 모두 위 문의 키와 사업체 slug 로 연결되고, 앱에는 비밀값을 넣지 않습니다.</p>
          <ul className="text-xs text-muted list-disc pl-4 space-y-1.5">
            <li><b className="text-fg">컨설팅 요청 → 문의 인입함.</b> 앱 서버(Cloudflare Worker) 비밀값에 <span className="mono">MANAGEAPP_URL={origin}</span> 과 위 문의 키를 <span className="mono">MANAGEAPP_INQUIRY_KEY</span> 로 넣으면, 앱의 &lsquo;컨설팅 요청하기&rsquo;가 &lsquo;집대리 앱&rsquo; 문의로 들어오고 알림이 갑니다.</li>
            <li><b className="text-fg">실제 계약 금액 → 앱 예상가격.</b> 상품마다 &lsquo;집대리 앱 공종&rsquo;을 고르면 최근 계약 금액이 공종·지역별로 집계됩니다(5건 미만 묶음은 내보내지 않고, 앱은 30건부터 기준으로 씁니다). 앱 빌드 환경변수 <span className="mono">VITE_PRICE_ENDPOINT</span> 에 아래 주소를 넣습니다.</li>
            <li><b className="text-fg">계약 링크 → 앱 &lsquo;내 시공&rsquo;.</b> 고객에게 보내는 계약 링크(<span className="mono">/c/…/…</span>)를 앱에 붙여 넣으면 일정·담당 기사·사진·잔액이 앱에서 보이고, 후기도 앱에서 남길 수 있습니다.</li>
          </ul>
          <div className="form-row mt-3">
            <label className="label">가격 집계 주소</label>
            <div className="flex gap-1.5"><div className="field mono text-xs flex items-center bg-bg text-muted break-all">{priceStats}</div><CopyButton text={priceStats} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
