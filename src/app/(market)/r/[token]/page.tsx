import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/origin";
import { QUOTE_STATUS, REQUEST_STATUS, type Badge, type QuoteItem } from "@/lib/market";
import { requestPage, vendorByTenant, type RequestPageMessage, type RequestPageQuote } from "@/lib/market-public";
import { acceptQuote, closeRequest, sendCustomerMessage, sharePhone } from "@/lib/actions/market-public";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { shortDate, won } from "@/lib/format";

/** 고객 요청 페이지: 비밀 링크(token)로만 연다. 검색 노출 금지 */
export const metadata: Metadata = { title: "내 견적 요청", robots: { index: false, follow: false } };

type Thread = { tenantId: string; name: string; slug: string | null; accepted: boolean; messages: RequestPageMessage[] };

/** 2026-09-23T05:05:31Z → 09.23 14:05 (한국 시간) */
function whenKST(iso: string): string {
  const s = new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  return s.length >= 16 ? `${s.slice(5, 7)}.${s.slice(8, 10)} ${s.slice(11, 16)}` : s;
}
/** date 는 그대로, timestamptz 는 한국 날짜로 → 2026.10.20 */
const ymd = (v: string | null | undefined) => {
  if (!v) return "";
  const s = v.length > 10 ? new Date(v).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) : v;
  return s.replace(/-/g, ".");
};

export default async function RequestTokenPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const admin = createAdminClient();
  const d = admin ? await requestPage(admin, token) : null;
  if (!admin || !d) {
    return (
      <section className="card p-5">
        <h1 className="text-lg font-bold">링크가 올바르지 않습니다</h1>
        <p className="text-sm text-muted mt-1">주소를 다시 확인해 주세요. 요청을 새로 남기려면 <Link href="/request">견적 요청</Link>으로 가세요.</p>
      </section>
    );
  }

  const r = d.request;
  const st = REQUEST_STATUS[r.status] ?? { label: r.status, badge: "wait" as Badge };
  const catLabel = (codes: string[]) => (codes ?? []).map((c) => d.categories[c] ?? c).join(" · ");
  const accepted = d.quotes.find((q) => q.id === r.accepted_quote_id) ?? null;
  const isOpen = r.status === "open";
  const isLive = isOpen || r.status === "accepted";
  const url = `${await siteOrigin()}/r/${token}`;
  const headline =
    r.status === "canceled" ? "취소된 요청입니다"
    : r.status === "closed" ? "마감된 요청입니다"
    : r.status === "accepted" ? "업체를 선택했습니다"
    : d.quotes.length ? `견적 ${d.quotes.length}건이 도착했습니다`
    : "업체들의 견적을 기다리는 중입니다";

  // 대화방 = 요청 × 업체. 견적 낸 업체 + 지목한 업체. 선택한 업체가 맨 위
  const threads = new Map<string, Thread>();
  for (const q of d.quotes) threads.set(q.tenant_id, { tenantId: q.tenant_id, name: q.vendor?.name ?? "업체", slug: q.vendor?.slug ?? null, accepted: q.id === r.accepted_quote_id, messages: [] });
  if (r.directed_tenant_id && !threads.has(r.directed_tenant_id)) {
    const v = await vendorByTenant(admin, r.directed_tenant_id);
    threads.set(r.directed_tenant_id, { tenantId: r.directed_tenant_id, name: v?.name ?? "지목한 업체", slug: v?.slug ?? null, accepted: false, messages: [] });
  }
  for (const m of d.messages) {
    const t = threads.get(m.tenant_id) ?? { tenantId: m.tenant_id, name: "업체", slug: null, accepted: false, messages: [] };
    t.messages.push(m);
    threads.set(m.tenant_id, t);
  }
  const threadList = [...threads.values()].sort((a, b) => Number(b.accepted) - Number(a.accepted));

  return (
    <>
      {/* (a) 요청 요약 */}
      <section className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">{r.name} 님의 견적 요청 · {shortDate(r.created_at)}</p>
            <h1 className="text-xl font-bold leading-snug mt-1">{headline}</h1>
          </div>
          <span className={`badge badge-${st.badge} shrink-0`}>{st.label}</span>
        </div>
        <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-1 text-sm mt-4">
          <dt className="text-muted">지역</dt>
          <dd>{r.region}{r.apt ? ` · ${r.apt}` : ""}</dd>
          {r.address && (<><dt className="text-muted">동·호수</dt><dd>{r.address} <span className="text-xs text-muted">(선택한 업체에게만)</span></dd></>)}
          {r.area_pyeong ? (<><dt className="text-muted">평형</dt><dd>{r.area_pyeong}평</dd></>) : null}
          {r.move_in_date && (<><dt className="text-muted">입주 예정</dt><dd>{ymd(r.move_in_date)}</dd></>)}
          <dt className="text-muted">원하는 시공</dt>
          <dd>{catLabel(r.categories) || "—"}</dd>
          {r.budget != null && (<><dt className="text-muted">예산</dt><dd><span className="mono">{won(r.budget)}</span>원</dd></>)}
          {r.message && (<><dt className="text-muted">요청 내용</dt><dd className="whitespace-pre-wrap">{r.message}</dd></>)}
        </dl>
        <p className="text-xs text-muted mt-3">
          견적 {d.quotes.length}건{isOpen ? ` · ${ymd(r.expires_at)}까지 견적을 받습니다` : ""}
          {r.phone_tail ? ` · 전화 끝자리 ${r.phone_tail}` : ""}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2 flex-wrap rounded border border-border bg-bg px-3 py-2">
          <span className="text-xs text-muted">이 페이지 주소를 저장해 두세요. 견적과 대화는 이 주소에서만 볼 수 있습니다.</span>
          <CopyButton text={url} label="주소 복사" />
        </div>
      </section>

      {/* (b) 받은 견적 */}
      <section className="card">
        <div className="panel-head"><h2>받은 견적 <span className="sub">{d.quotes.length}건</span></h2></div>
        {d.quotes.length === 0 && (
          <p className="px-4 py-4 text-sm text-muted">
            {isOpen ? "아직 도착한 견적이 없습니다. 업체가 견적을 보내면 이 페이지에 나타납니다." : "받은 견적이 없습니다."}
          </p>
        )}
        <ul className="divide-y divide-border">
          {d.quotes.map((q) => <QuoteCard key={q.id} q={q} token={token} canAccept={isOpen && q.status === "submitted"} isAccepted={accepted?.id === q.id} />)}
        </ul>
      </section>

      {/* (c) 업체와 대화 */}
      {threadList.length > 0 && (
        <div className="grid gap-4">
          <h2 className="text-sm font-semibold px-1">업체와 대화</h2>
          {threadList.map((t) => (
            <section key={t.tenantId} className={`card ${t.accepted ? "border-accent" : ""}`}>
              <div className="panel-head">
                <h2>{t.name} {t.accepted && <span className="badge badge-done">선택한 업체</span>}</h2>
                {t.slug && <Link href={`/vendors/${t.slug}`} className="text-xs">업체 소개</Link>}
              </div>
              <ul className="px-4 py-3 grid gap-2 text-sm">
                {t.messages.map((m) => {
                  const mine = m.sender === "customer";
                  return (
                    <li key={m.id} className={`max-w-[85%] ${mine ? "justify-self-end text-right" : "justify-self-start"}`}>
                      <div className="text-[11px] text-muted">{mine ? "나" : m.sender === "platform" ? "집대리" : t.name} · {whenKST(m.created_at)}</div>
                      <div className={`inline-block text-left rounded px-3 py-2 whitespace-pre-wrap ${mine ? "bg-accent text-white" : "bg-bg border border-border"}`}>{m.body}</div>
                    </li>
                  );
                })}
                {t.messages.length === 0 && <li className="text-xs text-muted">아직 대화가 없습니다. 궁금한 점을 먼저 물어보세요.</li>}
              </ul>
              {r.status !== "canceled" ? (
                <ActionForm action={sendCustomerMessage} className="px-4 pb-4">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="tenant_id" value={t.tenantId} />
                  <div className="flex gap-2 items-end">
                    <textarea name="body" rows={2} required maxLength={2000} className="field flex-1 min-h-[52px]" placeholder={`${t.name}에게 메시지`} aria-label={`${t.name}에게 메시지`} />
                    <SubmitButton className="btn btn-primary">보내기</SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <p className="px-4 pb-4 text-xs text-muted">취소된 요청이라 더 보낼 수 없습니다.</p>
              )}
            </section>
          ))}
        </div>
      )}

      {/* (d) 연락처 공개 — 업체를 선택한 뒤에만 */}
      {accepted && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">연락처 공개</h2>
          <p className="text-xs text-muted mt-1">
            전화번호(끝자리 {r.phone_tail})는 지금 {r.phone_shared ? <b className="text-text">선택한 업체에 공개되어 있습니다</b> : <b className="text-text">공개되지 않았습니다</b>}.
            공개를 켜면 선택한 업체({accepted.vendor?.name ?? "업체"})만 볼 수 있고, 다른 업체에는 끝까지 보이지 않습니다. 언제든 끌 수 있습니다.
          </p>
          <ActionForm action={sharePhone} className="mt-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="share" value={r.phone_shared ? "0" : "1"} />
            <SubmitButton className={r.phone_shared ? "btn" : "btn btn-primary"}>{r.phone_shared ? "공개 끄기" : "선택한 업체에 전화번호 공개"}</SubmitButton>
          </ActionForm>
        </section>
      )}

      {/* (e) 요청 마감·취소 */}
      {isLive && (
        <section className="card p-4">
          <details>
            <summary className="text-sm text-muted cursor-pointer">{isOpen ? "요청 취소" : "요청 마감"}</summary>
            <div className="mt-2 rounded border border-border bg-bg p-3">
              <p className="text-sm">
                {isOpen
                  ? "요청을 취소하면 아직 제출된 견적은 모두 미선택 처리되고 업체들은 더 견적을 낼 수 없습니다."
                  : "시공이 정해졌거나 더 진행하지 않을 때 마감합니다. 마감 뒤에도 이 페이지와 대화는 볼 수 있습니다."}
              </p>
              <ActionForm action={closeRequest} className="mt-2">
                <input type="hidden" name="token" value={token} />
                <SubmitButton className="btn btn-danger">{isOpen ? "요청 취소 확정" : "요청 마감 확정"}</SubmitButton>
              </ActionForm>
            </div>
          </details>
        </section>
      )}
    </>
  );
}

function QuoteCard({ q, token, canAccept, isAccepted }: { q: RequestPageQuote; token: string; canAccept: boolean; isAccepted: boolean }) {
  const v = q.vendor;
  const name = v?.name ?? "업체";
  const qs = QUOTE_STATUS[q.status] ?? { label: q.status, badge: "wait" as Badge };
  const items: QuoteItem[] = Array.isArray(q.items) ? q.items : [];
  const rating = v?.rating != null ? Number(v.rating) : null;
  return (
    <li className={`px-4 py-4 ${isAccepted ? "bg-accent-bg" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {v?.slug ? <Link href={`/vendors/${v.slug}`} className="font-semibold text-text no-underline">{name}</Link> : <b>{name}</b>}
            {v?.featured && <span className="badge badge-run">광고</span>}
            {isAccepted && <span className="badge badge-done">선택한 업체</span>}
          </div>
          <p className="text-xs text-muted mt-0.5">
            {rating != null ? <><span className="text-warn">★</span> {rating.toFixed(1)} ({v?.review_count ?? 0})</> : "후기 준비 중"} · 시공 {v?.done_jobs ?? 0}건{v?.response_note ? ` · ${v.response_note}` : ""}
          </p>
        </div>
        <span className={`badge badge-${qs.badge} shrink-0`}>{qs.label}</span>
      </div>
      <p className="mt-2"><b className="text-xl mono">{won(q.amount)}</b><span className="text-sm">원</span></p>
      {items.length > 0 && (
        <table className="tbl mt-2">
          <thead><tr><th>항목</th><th className="num">수량</th><th className="num">단가</th><th className="num">금액</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>{it.name}</td>
                <td className="num">{Number(it.qty) || 0}</td>
                <td className="num">{won(it.unit_price)}</td>
                <td className="num">{won(Math.round((Number(it.qty) || 0) * (Number(it.unit_price) || 0)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.message && <p className="text-sm mt-2 whitespace-pre-wrap">{q.message}</p>}
      {v?.highlights && v.highlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">{v.highlights.map((h) => <span key={h} className="chip">{h}</span>)}</div>
      )}
      <p className="text-xs text-muted mt-2">
        {q.available_from ? `시공 가능 ${ymd(q.available_from)}부터 · ` : ""}
        {q.valid_until ? `${ymd(q.valid_until)}까지 유효 · ` : ""}
        받은 날 {shortDate(q.created_at)}
      </p>
      {canAccept && (
        <details className="mt-3">
          <summary className="btn btn-primary w-full list-none [&::-webkit-details-marker]:hidden">이 업체로 진행</summary>
          <div className="mt-2 rounded border border-border bg-bg p-3">
            <p className="text-sm">{name}의 <b className="mono">{won(q.amount)}원</b> 견적으로 진행합니다. 다른 업체 견적은 미선택 처리되며 되돌릴 수 없습니다. 선택 뒤 아래 대화로 일정을 정하고, 필요하면 전화번호 공개를 켜세요.</p>
            <ActionForm action={acceptQuote} className="mt-2">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="quote_id" value={q.id} />
              <SubmitButton className="btn btn-primary w-full">선택 확정</SubmitButton>
            </ActionForm>
          </div>
        </details>
      )}
      {isAccepted && <p className="notice notice-success mt-3">이 업체를 선택했습니다. 아래 대화로 일정을 정하세요.</p>}
    </li>
  );
}
