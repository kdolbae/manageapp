import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { saveCashReceiptSettings, issueTeamsLinkCode, setTeamsConversationActive, tryCashReceiptMessage } from "@/lib/actions/cash-receipt";
import { fmtDateTime } from "@/lib/inbox";

type Conv = { conversation_id: string; conv_type: string; title: string | null; is_active: boolean; linked_by_name: string | null; created_at: string };
type Req = { id: string; source: string; sender_name: string | null; status: string; result_message: string | null; created_at: string };

const REQ_STATUS: Record<string, { label: string; badge: string }> = {
  received: { label: "처리 중", badge: "wait" },
  issued: { label: "발행", badge: "done" },
  needs_info: { label: "정보 부족", badge: "wait" },
  nothing_to_issue: { label: "발행할 것 없음", badge: "wait" },
  failed: { label: "실패", badge: "risk" },
};

const SAMPLE = `현장주소
서울특별시 ○○구 ○○아파트 101동 1001호
계약자명
홍길동
계약자연락처
010-0000-0000

현금영수증 신청합니다`;

/** 연동 설정 > 현금영수증 자동 발행 (Teams 채팅방 요청 → 발행 → 영수증 이미지 회신) */
export async function CashReceiptPanel({ tenantId, origin }: { tenantId: string; origin: string }) {
  const supabase = await createClient();
  const [{ data: cfgs }, { data: convs }, { data: reqs }] = await Promise.all([
    supabase.from("integration_config").select("kind, config, is_active").eq("tenant_id", tenantId).in("kind", ["cash_receipt", "teams_bot"]),
    supabase.from("teams_conversation").select("conversation_id, conv_type, title, is_active, linked_by_name, created_at").eq("tenant_id", tenantId).order("created_at"),
    supabase.from("cash_receipt_request").select("id, source, sender_name, status, result_message, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(10),
  ]);
  const byKind = new Map(((cfgs ?? []) as { kind: string; config: Record<string, string | undefined>; is_active: boolean }[]).map((c) => [c.kind, c]));
  const cr = byKind.get("cash_receipt");
  const bot = byKind.get("teams_bot");
  const conversations = (convs ?? []) as Conv[];
  const requests = (reqs ?? []) as Req[];
  const botReady = Boolean(process.env.TEAMS_BOT_APP_ID && process.env.TEAMS_BOT_APP_PASSWORD && process.env.TEAMS_BOT_TENANT_ID);
  const popbillReady = Boolean(process.env.POPBILL_LINK_ID && process.env.POPBILL_SECRET_KEY);
  const popbillTest = process.env.POPBILL_IS_TEST !== "0";
  const endpoint = `${origin}/api/teams/bot`;
  const codeValid = bot?.config.link_code && bot.config.link_code_expires_at && new Date(bot.config.link_code_expires_at) > new Date();

  return (
    <>
      <ActionForm action={saveCashReceiptSettings} className="card p-4">
        <h2 className="text-sm font-semibold mb-1">현금영수증 자동 발행</h2>
        <p className="text-xs text-muted mb-3">연결된 Teams 채팅방에 현장주소·계약자명·계약자연락처와 &lsquo;현금영수증 신청합니다&rsquo;가 올라오면, 연락처로 계약을 찾아 원장의 현금·계좌이체 입금 중 아직 발행 안 된 금액으로 발행하고 같은 채팅방에 영수증 이미지를 올립니다. 같은 입금은 두 번 발행되지 않습니다.</p>
        <div className="form-row">
          <label className="label" htmlFor="cr_provider">발행 방식</label>
          <select id="cr_provider" name="provider" defaultValue={cr?.config.provider ?? "mock"} className="field">
            <option value="mock">시험 발행 (국세청 전송 없음)</option>
            <option value="popbill">팝빌 {popbillReady ? (popbillTest ? "· 테스트 서버" : "· 실서버") : "· 서버 키 없음"}</option>
          </select>
        </div>
        <div className="form-row">
          <label className="label" htmlFor="cr_corp">가맹점 사업자번호</label>
          <input id="cr_corp" name="corp_num" defaultValue={cr?.config.corp_num ?? ""} placeholder="000-00-00000" className="field mono" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="form-row">
            <label className="label" htmlFor="cr_item">품목명 (비우면 계약 첫 품목)</label>
            <input id="cr_item" name="item_name" defaultValue={cr?.config.item_name ?? ""} placeholder="입주 시공" className="field" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="cr_tax">과세</label>
            <select id="cr_tax" name="taxation" defaultValue={cr?.config.taxation ?? "taxable"} className="field">
              <option value="taxable">과세 (금액에 부가세 포함)</option>
              <option value="exempt">면세</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" name="is_active" defaultChecked={cr?.is_active ?? false} /> 자동 발행 켜기</label>
        <SubmitButton className="btn btn-primary btn-sm">저장</SubmitButton>
      </ActionForm>

      <div className="card p-4">
        <h2 className="text-sm font-semibold mb-1">Teams 채팅방 연결</h2>
        {!botReady ? (
          <p className="text-xs text-muted">서버에 Teams 봇 값(TEAMS_BOT_APP_ID, TEAMS_BOT_APP_PASSWORD, TEAMS_BOT_TENANT_ID)이 아직 없습니다. 봇을 등록할 때 메시지 주소는 아래 주소를 넣습니다.</p>
        ) : (
          <p className="text-xs text-muted">채팅방에 집대리 앱(봇)을 추가한 뒤 연결 코드를 받아 그 채팅방에 보내세요. 연결된 채팅방에서만 발행합니다.</p>
        )}
        <div className="form-row mt-2">
          <label className="label">봇 메시지 주소</label>
          <div className="flex gap-1.5"><div className="field mono text-xs flex items-center bg-bg text-muted break-all">{endpoint}</div><CopyButton text={endpoint} /></div>
        </div>
        {botReady && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <a href="/api/teams/app-package" className="btn btn-sm">Teams 앱 패키지 받기 (.zip)</a>
            <ActionForm action={issueTeamsLinkCode} className="inline-block">
              <SubmitButton className="btn btn-primary btn-sm">채팅방 연결 코드 받기</SubmitButton>
            </ActionForm>
            {codeValid && <span className="text-xs text-muted">유효한 코드: <span className="mono">집대리 연결 {bot?.config.link_code}</span></span>}
          </div>
        )}
        <table className="tbl">
          <thead><tr><th>채팅방</th><th>연결한 사람</th><th></th></tr></thead>
          <tbody>
            {conversations.map((c) => (
              <tr key={c.conversation_id}>
                <td className="text-xs">{c.title ?? (c.conv_type === "channel" ? "채널" : "그룹 채팅")} <span className="text-muted">{fmtDateTime(c.created_at)}</span></td>
                <td className="text-xs">{c.linked_by_name ?? "-"}</td>
                <td className="text-right">
                  <ActionForm action={setTeamsConversationActive}>
                    <input type="hidden" name="conversation_id" value={c.conversation_id} />
                    <input type="hidden" name="active" value={c.is_active ? "0" : "1"} />
                    <SubmitButton className="btn btn-sm">{c.is_active ? "끄기" : "켜기"}</SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
            {conversations.length === 0 && <tr><td colSpan={3} className="text-muted text-xs">연결된 채팅방이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <ActionForm action={tryCashReceiptMessage} className="card p-4">
        <h2 className="text-sm font-semibold mb-1">요청 시험하기</h2>
        <p className="text-xs text-muted mb-2">Teams 없이 같은 흐름을 돌려 봅니다. 발행 방식이 &lsquo;시험 발행&rsquo;이면 국세청으로 가지 않습니다.</p>
        <textarea name="text" rows={8} defaultValue={SAMPLE} className="field mono text-xs" />
        <SubmitButton className="btn btn-sm mt-2">처리해 보기</SubmitButton>
      </ActionForm>

      <div className="card">
        <div className="panel-head"><h2>최근 현금영수증 요청 <span className="sub">10건</span></h2></div>
        <table className="tbl">
          <thead><tr><th>시각</th><th>보낸 사람</th><th>결과</th></tr></thead>
          <tbody>
            {requests.map((r) => {
              const s = REQ_STATUS[r.status] ?? { label: r.status, badge: "wait" };
              return (
                <tr key={r.id}>
                  <td className="mono text-xs text-muted whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td className="text-xs">{r.sender_name ?? "-"}{r.source === "manual" && <span className="text-muted"> (시험)</span>}</td>
                  <td className="text-xs"><span className={`badge badge-${s.badge}`}>{s.label}</span>{r.result_message && <div className="text-muted max-w-[320px]">{r.result_message}</div>}</td>
                </tr>
              );
            })}
            {requests.length === 0 && <tr><td colSpan={3} className="text-muted text-xs">아직 요청이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
