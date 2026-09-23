import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { phone, won } from "@/lib/format";
import { fmtDateTime } from "@/lib/inbox";
import { MARKET_REQUEST_SELECT, QUOTE_STATUS, REQUEST_STATUS, categoryLabels, platformCategories, quoteTotal, type MarketRequest } from "@/lib/market";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { convertQuote, markMessagesRead, sendVendorMessage, submitQuote, updateQuote, withdrawQuote } from "@/lib/actions/market";
import { SENDER_LABEL, UUID, deadlineText, isOpen, myQuoteFor, requestTitle, type MyQuote, type RequestMessage } from "../../data";
import { QuoteFields } from "../../quote-fields";

export const metadata = { title: "견적 요청" };

const SENDER_BADGE: Record<string, string> = { customer: "run", vendor: "wait", platform: "risk" };

/** 낸 견적의 요약(품목 표 + 합계 + 조건) */
function QuoteSummary({ quote }: { quote: MyQuote }) {
  const itemTotal = quoteTotal(quote.items);
  return (
    <div className="text-sm">
      {quote.items.length > 0 ? (
        <table className="tbl mb-2">
          <thead>
            <tr>
              <th>품목</th>
              <th className="text-right">수량</th>
              <th className="text-right">단가</th>
              <th className="text-right">금액</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((it, i) => (
              <tr key={i}>
                <td>{it.name}</td>
                <td className="num">{it.qty}</td>
                <td className="num">{won(it.unit_price)}</td>
                <td className="num">{won(Math.round(it.qty * it.unit_price))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>합계{itemTotal !== Number(quote.amount) && " (견적 금액과 다름)"}</td>
              <td className="num">{won(quote.amount)}원</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="mb-2">
          견적 금액 <span className="mono text-lg font-semibold">{won(quote.amount)}</span>원
        </p>
      )}
      <dl className="grid grid-cols-[90px_1fr] gap-y-1 gap-x-3 text-xs">
        <dt className="text-muted">시공 가능일</dt>
        <dd className="mono">{quote.available_from ?? "—"}</dd>
        <dt className="text-muted">견적 유효일</dt>
        <dd className="mono">{quote.valid_until ?? "—"}</dd>
        <dt className="text-muted">제출</dt>
        <dd className="mono">{fmtDateTime(quote.created_at)}{quote.updated_at !== quote.created_at && ` · 수정 ${fmtDateTime(quote.updated_at)}`}</dd>
      </dl>
      {quote.message && <p className="mt-2 whitespace-pre-wrap text-xs border-l-2 border-border pl-2">{quote.message}</p>}
    </div>
  );
}

export default async function MarketRequestPage({ params }: PageProps<"/market/requests/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const canWrite = session.can("market.write");
  const supabase = await createClient();
  const now = new Date().toISOString();

  // 뷰가 우리 업체에 보이는 요청만 돌려준다 (이름 가림, 연락처는 선택된 업체 + 고객 동의 때만)
  const { data } = await supabase.from("market_request").select(MARKET_REQUEST_SELECT).eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as MarketRequest;

  const [quote, cats, { data: msgRows }] = await Promise.all([
    myQuoteFor(supabase, tid, id),
    platformCategories(supabase, false),
    supabase.from("request_message").select("id, sender, sender_id, body, created_at, read_at").eq("request_id", id).eq("tenant_id", tid).order("created_at").limit(500),
  ]);
  const messages = (msgRows ?? []) as RequestMessage[];
  // 화면을 열면 고객 메시지를 읽음으로. 렌더 중이라 재검증 없이 DB 만 고친다 (화면은 이미 최신 대화를 그린다).
  if (messages.some((m) => m.sender === "customer" && !m.read_at)) await markMessagesRead(id);

  const open = isOpen(r, now);
  const mineAccepted = r.accepted_tenant_id === tid;
  const deadline = deadlineText(r, now);
  const st = mineAccepted
    ? { label: "우리 선택됨", badge: "done" }
    : r.status === "accepted"
      ? { label: "다른 업체 선택", badge: "wait" }
      : (REQUEST_STATUS[r.status] ?? { label: r.status, badge: "wait" });
  const qs = quote ? (QUOTE_STATUS[quote.status] ?? { label: quote.status, badge: "wait" }) : null;
  const hasContact = Boolean(r.contact_name || r.contact_address);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px] items-start">
      <div className="grid gap-4">
        <div className="card p-4">
          <div className="text-xs text-muted mb-3">
            <Link href="/market">요청</Link>
            <span className="mx-1.5">/</span>
            <span className="text-text font-medium">{requestTitle(r)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold">
              {r.name_masked} 고객 <span className="text-muted font-normal">· {requestTitle(r)}</span>
            </h2>
            <span className={`badge badge-${st.badge}`}>{st.label}</span>
            {r.directed_tenant_id === tid && <span className="badge badge-run">우리 지목</span>}
            {deadline && <span className="badge badge-wait">{deadline}</span>}
          </div>
          <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 gap-x-3 text-sm">
            <dt className="text-muted">분류</dt>
            <dd>{categoryLabels(r.categories, cats) || "—"}</dd>
            <dt className="text-muted">지역</dt>
            <dd>{r.region}</dd>
            <dt className="text-muted">단지</dt>
            <dd>{r.apt ?? "—"}</dd>
            <dt className="text-muted">평수</dt>
            <dd>{r.area_pyeong ? `${r.area_pyeong}평` : "—"}</dd>
            <dt className="text-muted">입주일</dt>
            <dd className="mono">{r.move_in_date ?? "—"}</dd>
            <dt className="text-muted">예산</dt>
            <dd>{r.budget ? `${won(r.budget)}원` : "—"}</dd>
            <dt className="text-muted">요청</dt>
            <dd className="mono">{fmtDateTime(r.created_at)}</dd>
            <dt className="text-muted">견적 마감</dt>
            <dd className="mono">{fmtDateTime(r.expires_at)}</dd>
          </dl>
          <h3 className="text-xs font-semibold text-muted mt-4 mb-1">요청 내용</h3>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{r.message || <span className="text-muted">내용 없음</span>}</p>
        </div>

        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold">내 견적</h2>
            {qs && <span className={`badge badge-${qs.badge}`}>{qs.label}</span>}
          </div>

          {!quote && (
            <>
              {open && canWrite && (
                <ActionForm action={submitQuote}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <p className="text-xs text-muted mb-3">고객은 여러 업체의 견적을 비교해 하나를 고릅니다. 금액과 함께 포함 범위·가능 날짜를 적어 주면 선택률이 올라갑니다.</p>
                  <QuoteFields idPrefix="new" />
                  <SubmitButton>견적 내기</SubmitButton>
                </ActionForm>
              )}
              {open && !canWrite && <p className="text-sm text-muted">견적을 내려면 견적 제출 권한(market.write)이 필요합니다.</p>}
              {!open && <p className="text-sm text-muted">마감된 요청입니다. 견적을 내지 않았습니다.</p>}
            </>
          )}

          {quote && (
            <>
              <QuoteSummary quote={quote} />

              {quote.status === "submitted" && (
                <div className="mt-4 grid gap-3">
                  {open ? (
                    <p className="text-xs text-muted">고객이 아직 고르는 중입니다. 선택되면 알림이 오고 고객 이름·주소가 열립니다.</p>
                  ) : (
                    <p className="text-xs text-muted">요청 기간이 지났습니다. 고객이 견적을 고르지 않으면 이 상태로 남습니다.</p>
                  )}
                  {canWrite && open && (
                    <details>
                      <summary className="cursor-pointer text-sm text-accent">견적 수정</summary>
                      <ActionForm action={updateQuote} className="mt-3">
                        <input type="hidden" name="id" value={quote.id} />
                        <QuoteFields quote={quote} idPrefix="edit" />
                        <SubmitButton className="btn btn-primary btn-sm">저장</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                  {canWrite && (
                    <details>
                      <summary className="cursor-pointer text-sm text-danger">견적 철회…</summary>
                      <p className="text-xs text-muted mt-2 mb-3">철회하면 고객 화면에서 사라지고, 같은 요청에 다시 낼 수 없습니다.</p>
                      <ActionForm action={withdrawQuote}>
                        <input type="hidden" name="id" value={quote.id} />
                        <SubmitButton className="btn btn-sm btn-danger">철회 확정</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </div>
              )}

              {quote.status === "accepted" && (
                <div className="mt-4">
                  {quote.contract_id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/contracts/${quote.contract_id}`} className="btn btn-primary">계약 보기</Link>
                      <span className="text-xs text-muted">이 견적으로 만든 계약입니다. 시공 일정·수납은 계약 화면에서 관리합니다.</span>
                    </div>
                  ) : canWrite ? (
                    <ActionForm action={convertQuote}>
                      <input type="hidden" name="id" value={quote.id} />
                      <p className="notice notice-success mb-3">고객이 우리 견적을 선택했습니다. 계약으로 만들면 우리 사업체에 고객·현장·계약이 생기고, 시공 배정과 수납을 그대로 이어서 할 수 있습니다. 집대리 수수료는 이 계약 금액을 기준으로 정산됩니다.</p>
                      <SubmitButton>계약으로 만들기</SubmitButton>
                    </ActionForm>
                  ) : (
                    <p className="text-sm text-muted">고객이 우리 견적을 선택했습니다. 계약 전환은 견적 제출 권한이 있는 구성원이 합니다.</p>
                  )}
                </div>
              )}

              {quote.status === "declined" && <p className="mt-4 text-sm text-muted">고객이 다른 업체를 선택했거나 요청을 종료했습니다.</p>}
              {quote.status === "withdrawn" && <p className="mt-4 text-sm text-muted">철회한 견적입니다. 같은 요청에 다시 낼 수 없습니다.</p>}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">고객 연락처</h2>
          {hasContact ? (
            <dl className="grid grid-cols-[60px_1fr] gap-y-1.5 gap-x-3 text-sm">
              <dt className="text-muted">이름</dt>
              <dd>{r.contact_name ?? r.name_masked}</dd>
              <dt className="text-muted">주소</dt>
              <dd>{r.contact_address ?? "—"}</dd>
              <dt className="text-muted">전화</dt>
              <dd>
                {r.contact_phone ? (
                  <a href={`tel:${r.contact_phone}`} className="btn btn-primary btn-sm">
                    전화 걸기 <span className="mono font-normal">{phone(r.contact_phone)}</span>
                  </a>
                ) : (
                  <span className="text-xs text-muted">고객이 전화번호 공개를 켜면 보입니다. 그때까지는 아래 대화로 연락하세요.</span>
                )}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted">고객 전화번호는 고객이 이 업체를 선택하고 공개를 켜야 보입니다. 그때까지는 아래 대화로 연락하세요.</p>
          )}
        </div>

        <div className="card">
          <div className="panel-head">
            <h2>
              대화 <span className="sub">{messages.length}건</span>
            </h2>
          </div>
          <ul className="divide-y divide-border max-h-[520px] overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id} className={"px-4 py-2.5 text-sm " + (m.sender === "vendor" ? "bg-zebra" : "")}>
                <div className="flex items-center gap-2 text-xs text-muted mb-0.5">
                  <span className={`badge badge-${SENDER_BADGE[m.sender] ?? "wait"}`}>{SENDER_LABEL[m.sender] ?? m.sender}</span>
                  <span className="mono">{fmtDateTime(m.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
            {messages.length === 0 && <li className="px-4 py-3 text-sm text-muted">아직 대화가 없습니다.</li>}
          </ul>
          {canWrite ? (
            <ActionForm action={sendVendorMessage} className="p-4 border-t border-border">
              <input type="hidden" name="request_id" value={r.id} />
              <label className="label" htmlFor="msg-body">고객에게 메시지</label>
              <textarea id="msg-body" name="body" required maxLength={2000} rows={3} placeholder="일정·범위·추가 비용 등을 여기서 조율하세요" className="field" />
              <div className="flex items-start justify-between gap-2 mt-2">
                <span className="text-xs text-muted">
                  {!quote && open ? "견적을 내면 고객이 답장할 수 있습니다." : "연락처 교환 없이 이 대화로 조율하세요. 전화번호는 고객이 공개하면 위에 보입니다."}
                </span>
                <SubmitButton className="btn btn-primary btn-sm">보내기</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <p className="p-4 text-xs text-muted border-t border-border">메시지를 보내려면 견적 제출 권한(market.write)이 필요합니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
