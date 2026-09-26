import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues, labelOf } from "@/lib/codes";
import { phone, won } from "@/lib/format";
import { TIME_SLOT, JOB_KIND } from "@/lib/contracts";
import { SIGN_METHOD, recordCode, signatureStale, type SigningInfo, type SignatureSummary } from "@/lib/signing";
import { SignForm } from "@/components/sign-form";
import { signOnDevice } from "@/lib/actions/signing";

export const metadata = { title: "계약서 서명" };

/** 서명 시각을 한국 시간으로: 2026.09.26 14:05 (서버는 UTC 로 돌 수 있으므로 Asia/Seoul 고정) */
function fmtSignedAt(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16).replace(/-/g, ".");
}

/** 최근 서명 요약: 서명자·시각·방법(·입회 직원)·확인번호·서명 이미지. 완료 화면과 "이미 서명됨" 화면이 같이 쓴다 */
function SignatureView({ sig }: { sig: SignatureSummary }) {
  return (
    <div className="grid gap-3 text-sm">
      <div className="grid grid-cols-[76px_1fr] gap-y-1.5 gap-x-2">
        <span className="text-muted">서명자</span><span className="font-semibold">{sig.signer_name}</span>
        <span className="text-muted">서명 시각</span><span className="mono">{fmtSignedAt(sig.signed_at)}</span>
        <span className="text-muted">서명 방법</span><span>{SIGN_METHOD[sig.method] ?? sig.method}{sig.witnessed_by && <span className="text-muted"> · {sig.witnessed_by} 입회</span>}</span>
        <span className="text-muted">확인번호</span><span className="mono">{recordCode(sig.record_hash)}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sig.signature_data} alt="서명" className="h-20 w-auto max-w-full bg-white rounded border border-border" />
    </div>
  );
}

/**
 * 현장 기기(태블릿·박람회 노트북) 고객 서명 화면. 직원이 로그인한 상태에서 열어 고객에게 건넨다.
 *  · 기본: 계약 내용·약관 확인 → 동의 → 서명 (SignForm → signOnDevice → ?done=1 로 돌아온다)
 *  · ?done=1: 방금 저장된 서명 요약 + 다음 동작(다음 계약 등록·계약 상세·홈)
 *  · 이미 서명된 계약: 요약만 보여 주고 ?again=1 로 다시 받을 수 있다. 서명 뒤 계약 내용이 바뀌었으면 경고
 */
export default async function SignPage({ params, searchParams }: PageProps<"/sign/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireTenant();
  const supabase = await createClient();
  const [{ data }, workAreas] = await Promise.all([
    supabase.rpc("contract_signing_info", { p_contract: id }),
    codeValues(session.current.tenant_id, "work_area"),
  ]);
  if (!data) notFound(); // 계약이 없거나 이 사용자에게 보이지 않는다 (RLS)
  const info = data as SigningInfo;
  const snap = info.snapshot;
  const sig = info.signature;
  const stale = signatureStale(info);
  const justDone = sp.done === "1" && sig !== null;
  const resign = sp.again === "1";
  const siteLine = [snap.site.name, snap.site.dong && `${snap.site.dong}동`, snap.site.ho && `${snap.site.ho}호`].filter(Boolean).join(" ");

  return (
    <>
      {/* 머리: 사업체·계약 기본 정보 */}
      <section className="card p-5">
        <p className="text-xs text-muted">{snap.tenant.name}</p>
        <h1 className="text-xl font-bold mt-1">계약서 확인 및 서명</h1>
        <div className="mt-3 grid grid-cols-[76px_1fr] gap-y-1.5 gap-x-2 text-sm">
          <span className="text-muted">계약번호</span><span className="mono">{snap.contract_no}</span>
          <span className="text-muted">계약일</span><span className="mono">{snap.contract_date}</span>
          <span className="text-muted">계약자</span><span><b>{snap.customer.name}</b> <span className="mono text-muted">{phone(snap.customer.phone)}</span></span>
          <span className="text-muted">현장</span>
          <span>{siteLine || <span className="zero">—</span>}{snap.site.address && <div className="text-xs text-muted">{snap.site.address}</div>}</span>
        </div>
      </section>

      {/* 계약 내용: 품목·금액, 시공 예정 */}
      <section className="card overflow-x-auto">
        <div className="panel-head"><h2>계약 내용 <span className="sub">품목 {snap.lines.length}개</span></h2></div>
        <table className="tbl">
          <thead><tr><th>품목</th><th>작업 단위</th><th className="text-right">수량</th><th className="text-right">금액</th></tr></thead>
          <tbody>
            {snap.lines.map((l, i) => (
              <tr key={i}>
                <td className="font-semibold">{l.name}</td>
                <td>{labelOf(workAreas, l.work_area_code) || <span className="zero">—</span>}</td>
                <td className="num">{Number(l.qty)}</td>
                <td className="num font-semibold">{won(l.amount)}</td>
              </tr>
            ))}
            {snap.lines.length === 0 && <tr><td colSpan={4} className="text-muted">품목이 없습니다.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3}>총 금액</td><td className="num text-text font-semibold">{won(snap.sale_total)}원</td></tr></tfoot>
        </table>
        <div className="border-t border-border p-4">
          <h3 className="text-sm font-semibold mb-1.5">시공 예정</h3>
          <ul className="grid gap-1 text-sm">
            {snap.jobs.map((j, i) => (
              <li key={i}>
                <span className="font-medium">{labelOf(workAreas, j.work_area_code) || "전체"}</span>
                {j.kind !== "install" && <span className="text-muted"> {JOB_KIND[j.kind] ?? j.kind}</span>}
                <span className="text-muted"> · </span>
                {j.scheduled_date
                  ? <span className="mono">{j.scheduled_date}{j.time_slot !== "any" && ` ${TIME_SLOT[j.time_slot] ?? ""}`}</span>
                  : <span className="text-muted">일정 협의</span>}
              </li>
            ))}
            {snap.jobs.length === 0 && <li className="text-muted">아직 잡힌 시공 일정이 없습니다. 일정은 협의해 정합니다.</li>}
          </ul>
        </div>
      </section>

      {justDone && sig ? (
        /* a. 방금 서명 저장됨 — 직원이 기기를 돌려받고 다음 동작으로 */
        <section className="card p-5 grid gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="badge badge-done">서명 완료</span>
            <h2 className="text-lg font-bold">서명이 저장되었습니다</h2>
          </div>
          <p className="text-sm text-muted">계약 내용·약관과 서명이 함께 보관되었습니다. 감사합니다.</p>
          <SignatureView sig={sig} />
          <div className="flex gap-2 flex-wrap pt-1">
            <Link href="/contracts/new" className="btn btn-primary btn-lg">다음 계약 등록</Link>
            <Link href={`/contracts/${id}`} className="btn btn-lg">계약 상세</Link>
            <Link href="/" className="btn btn-lg">홈</Link>
          </div>
        </section>
      ) : sig && !resign ? (
        /* b. 이미 서명된 계약 — 요약만. 계약 내용이 바뀌었으면 다시 받도록 경고 */
        <section className="card p-5 grid gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`badge ${stale ? "badge-risk" : "badge-done"}`}>{stale ? "재서명 필요" : "서명 완료"}</span>
            <h2 className="text-lg font-bold">이미 서명된 계약입니다</h2>
          </div>
          {stale && <p className="notice notice-danger">서명 뒤 계약 내용(품목·금액·계약자·현장)이 바뀌었습니다. 다시 서명을 받아 주세요.</p>}
          <SignatureView sig={sig} />
          <div className="flex gap-2 flex-wrap pt-1">
            <Link href={`/sign/${id}?again=1`} className="btn btn-primary btn-lg">다시 서명 받기</Link>
            <Link href={`/contracts/${id}`} className="btn btn-lg">계약 상세</Link>
          </div>
        </section>
      ) : (
        /* c. 서명 받기 (첫 서명 또는 ?again=1 재서명) */
        <>
          <section className="card p-5">
            <SignForm
              action={signOnDevice}
              hidden={{ id }}
              terms={info.terms}
              defaultName={snap.customer.name ?? ""}
              submitLabel="서명 완료"
              intro={
                <div className="grid gap-1">
                  <p className="text-sm">아래 계약 내용과 약관을 확인하신 뒤 서명해 주세요. 서명은 계약 내용·약관과 함께 안전하게 보관됩니다.</p>
                  {sig && <p className="text-xs text-muted">이전 서명({sig.signer_name} · {fmtSignedAt(sig.signed_at)})이 있습니다. 새로 서명하면 최신 서명이 유효합니다.</p>}
                </div>
              }
            />
          </section>
          {/* 고객이 서명을 미루면 직원이 돌아갈 길 (PWA 전체화면에는 뒤로 가기가 없다) */}
          <p className="text-xs text-muted text-center"><Link href={`/contracts/${id}`}>서명 없이 계약 상세로 돌아가기</Link></p>
        </>
      )}
    </>
  );
}
