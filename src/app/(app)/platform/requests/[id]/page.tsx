import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { phone, won } from "@/lib/format";
import { fmtDateTime } from "@/lib/inbox";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { FormButton } from "@/app/(app)/groupware/ui";
import { Crumb, KV } from "@/app/(app)/people/shared";
import { closeRequestAdmin, sendPlatformMessage } from "@/lib/actions/platform";
import { QUOTE_STATUS, REQUEST_STATUS, categoryLabels, maskName, platformCategories } from "@/lib/market";
import { EmptyRow, StatusBadge, maskPhone } from "../../shared";
import {
  MESSAGE_SELECT,
  QUOTE_SELECT,
  REQUEST_SELECT,
  SENDER,
  UUID,
  nowIso,
  platformVendors,
  vendorName,
  vendorNameMap,
  type Quote,
  type RequestMessage,
  type ServiceRequest,
} from "../../data";

export const metadata = { title: "요청 상세" };

const SENDER_BADGE: Record<string, string> = { customer: "run", vendor: "wait", platform: "done" };

export default async function RequestPage({ params }: PageProps<"/platform/requests/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requireTenant();
  const supabase = await createClient();
  const [{ data }, { data: qRows }, { data: mRows }, vendors, cats] = await Promise.all([
    supabase.from("service_request").select(REQUEST_SELECT).eq("id", id).maybeSingle(),
    supabase.from("quote").select(QUOTE_SELECT).eq("request_id", id).order("created_at"),
    supabase.from("request_message").select(MESSAGE_SELECT).eq("request_id", id).order("created_at"),
    platformVendors(supabase),
    platformCategories(supabase, false),
  ]);
  if (!data) notFound();
  const r = data as ServiceRequest;
  const quotes = (qRows ?? []) as Quote[];
  const messages = (mRows ?? []) as RequestMessage[];
  const names = vendorNameMap(vendors);
  // 대화방 = 요청 × 업체. 견적을 냈거나 글을 남겼거나 지목된 업체마다 하나
  const threads = Array.from(new Set([...quotes.map((q) => q.tenant_id), ...messages.map((m) => m.tenant_id), ...(r.directed_tenant_id ? [r.directed_tenant_id] : [])]));
  const open = r.status === "open" || r.status === "accepted";
  const expired = r.status === "open" && r.expires_at < nowIso();
  const accepted = quotes.find((q) => q.id === r.accepted_quote_id);
  const utm = Object.entries(r.utm ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const title = `${r.region}${r.apt ? ` · ${r.apt}` : ""}`;

  return (
    <div className="p-4">
      <Crumb href="/platform/requests" parent="요청·견적" current={title} />
      <div className="grid gap-4 lg:grid-cols-[1fr_400px] items-start">
        <div className="grid gap-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="text-base font-semibold">{title}</h2>
              <StatusBadge s={REQUEST_STATUS[r.status]} fallback={r.status} />
              {expired && <span className="badge badge-wait">기한 지남</span>}
              {r.phone_shared && <span className="badge badge-run">고객이 전화 공개함</span>}
            </div>
            <KV k="고객">
              <details>
                <summary className="cursor-pointer select-none">
                  <span className="font-medium">{maskName(r.name)}</span> <span className="mono text-xs text-muted">{maskPhone(r.phone)}</span>{" "}
                  <span className="text-xs text-accent">보기</span>
                </summary>
                <div className="mt-1">
                  <span className="font-medium">{r.name}</span> <span className="mono">{phone(r.phone)}</span>
                  {r.email && <span className="text-xs text-muted ml-2">{r.email}</span>}
                </div>
              </details>
            </KV>
            <KV k="주소">{r.address || <span className="text-muted">— (단지까지만)</span>}</KV>
            <KV k="평수 · 입주">
              {r.area_pyeong ? `${r.area_pyeong}평` : "—"} · <span className="mono">{r.move_in_date ?? "미정"}</span>
            </KV>
            <KV k="분류">{categoryLabels(r.categories, cats) || "—"}</KV>
            <KV k="예산">{r.budget != null ? <span className="mono">{won(r.budget)}원</span> : <span className="text-muted">—</span>}</KV>
            <KV k="요청 내용"><span className="whitespace-pre-wrap">{r.message || <span className="text-muted">—</span>}</span></KV>
            {r.directed_tenant_id && <KV k="지목 업체">{vendorName(names, r.directed_tenant_id)} <span className="text-xs text-muted">(이 업체에게만 보낸 요청)</span></KV>}
            <KV k="선택 견적">
              {accepted ? (
                <>
                  {vendorName(names, accepted.tenant_id)} · <span className="mono">{won(accepted.amount)}원</span>
                  {accepted.contract_id && <span className="badge badge-done ml-2">계약 전환됨</span>}
                </>
              ) : (
                <span className="text-muted">—</span>
              )}
            </KV>
            <KV k="접수 · 만료">
              <span className="mono text-xs">
                {fmtDateTime(r.created_at)} 접수 · {fmtDateTime(r.expires_at)} 만료
                {r.closed_at && ` · ${fmtDateTime(r.closed_at)} 닫힘`}
              </span>
            </KV>
            {r.external_id && <KV k="외부 회원"><span className="mono text-xs">{r.external_id}</span></KV>}
            {utm.length > 0 && <KV k="유입"><span className="mono text-xs break-all">{utm.map(([k, v]) => `${k}=${String(v)}`).join(" · ")}</span></KV>}
          </div>

          <div className="card overflow-x-auto">
            <div className="panel-head">
              <h2>
                견적 <span className="sub">{quotes.length}건</span>
              </h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>업체</th>
                  <th className="text-right">금액</th>
                  <th>품목</th>
                  <th>메시지</th>
                  <th>가능일 · 유효</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className={q.id === r.accepted_quote_id ? "is-selected" : ""}>
                    <td className="font-medium whitespace-nowrap">{vendorName(names, q.tenant_id)}</td>
                    <td className="num">{won(q.amount)}</td>
                    <td className="text-xs">
                      {q.items?.length ? (
                        q.items.map((i, idx) => (
                          <div key={idx} className="whitespace-nowrap">
                            {i.name} × {i.qty} · {won(i.unit_price)}원
                          </div>
                        ))
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-xs whitespace-pre-wrap max-w-[260px]">{q.message || <span className="text-muted">—</span>}</td>
                    <td className="mono text-xs whitespace-nowrap">
                      {q.available_from ?? "—"} · {q.valid_until ?? "—"}
                    </td>
                    <td>
                      <StatusBadge s={QUOTE_STATUS[q.status]} fallback={q.status} />
                      {q.contract_id && <div className="text-xs text-muted mt-0.5">계약 전환됨</div>}
                    </td>
                  </tr>
                ))}
                {quotes.length === 0 && <EmptyRow cols={6}>아직 견적이 없습니다.</EmptyRow>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-4">
          {threads.map((tid) => {
            const q = quotes.find((x) => x.tenant_id === tid);
            const msgs = messages.filter((m) => m.tenant_id === tid);
            return (
              <div key={tid} className="card">
                <div className="panel-head">
                  <h2>
                    {vendorName(names, tid)} <span className="sub">{q ? `${won(q.amount)}원 · ${QUOTE_STATUS[q.status]?.label ?? q.status}` : "견적 없음"}</span>
                  </h2>
                  <span className="text-xs text-muted">대화 {msgs.length}건</span>
                </div>
                <ol className="p-3 grid gap-2 max-h-[320px] overflow-y-auto">
                  {msgs.map((m) => (
                    <li key={m.id} className="text-sm">
                      <span className={`badge badge-${SENDER_BADGE[m.sender] ?? "wait"}`}>{SENDER[m.sender] ?? m.sender}</span>
                      <span className="mono text-xs text-muted ml-2">{fmtDateTime(m.created_at)}</span>
                      <p className="whitespace-pre-wrap mt-0.5">{m.body}</p>
                    </li>
                  ))}
                  {msgs.length === 0 && <li className="text-xs text-muted">아직 대화가 없습니다.</li>}
                </ol>
                <ActionForm action={sendPlatformMessage} className="p-3 border-t border-border">
                  <input type="hidden" name="request_id" value={r.id} />
                  <input type="hidden" name="tenant_id" value={tid} />
                  <textarea name="body" rows={2} maxLength={2000} required className="field" placeholder="집대리 이름으로 이 대화방에 남깁니다. 고객과 이 업체가 봅니다." />
                  <SubmitButton className="btn btn-sm mt-2" pendingText="보내는 중…">집대리 메시지 보내기</SubmitButton>
                </ActionForm>
              </div>
            );
          })}
          {threads.length === 0 && <p className="card p-4 text-sm text-muted">견적을 낸 업체가 없어 대화방이 없습니다.</p>}

          {open && (
            <details className="card p-4">
              <summary className="cursor-pointer text-sm font-semibold">요청 닫기</summary>
              <ActionForm action={closeRequestAdmin} className="mt-2">
                <input type="hidden" name="id" value={r.id} />
                <p className="text-xs text-muted mb-2">
                  마감은 정상 종료(선택된 업체가 있으면 그대로), 취소는 고객 변심·스팸입니다. 닫으면 새 견적은 들어오지 않습니다. 이미 제출된 견적의 상태는 바뀌지 않습니다.
                </p>
                <div className="flex gap-2">
                  <FormButton name="status" value="closed" className="btn btn-sm">마감</FormButton>
                  <FormButton name="status" value="canceled" className="btn btn-sm btn-danger">취소 처리</FormButton>
                </div>
              </ActionForm>
            </details>
          )}
          <Link href="/platform/requests" className="btn">목록으로</Link>
        </div>
      </div>
    </div>
  );
}
