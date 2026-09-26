import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { phone, won } from "@/lib/format";
import { workAreaClass } from "@/lib/contracts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createContract, createCustomerForContract } from "@/lib/actions/contracts";

export const metadata = { title: "계약 등록" };

type Customer = { id: string; name: string; phone: string | null; address: string | null; branch_id: string | null; source_code: string | null; referrer_partner_id: string | null };

export default async function NewContractPage({ searchParams }: PageProps<"/contracts/new">) {
  const session = await requireTenant();
  const tid = session.current.tenant_id;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const customerId = typeof sp.customer === "string" ? sp.customer : "";
  const supabase = await createClient();

  if (!session.can("contract.write")) {
    return (
      <div>
        <div className="panel-head"><h1>계약 등록</h1></div>
        <p className="p-4 text-sm text-muted">계약 등록 권한이 없습니다.</p>
      </div>
    );
  }

  // 1단계: 계약자 고르기
  if (!customerId) {
    const canAddCustomer = session.can("customer.write");
    let results: Customer[] = [];
    if (q) {
      const digits = q.replace(/\D/g, "");
      let query = supabase.from("customer").select("id, name, phone, address, branch_id, source_code, referrer_partner_id").eq("tenant_id", tid).is("deleted_at", null).limit(30);
      query = digits.length >= 4 ? query.or(`name.ilike.%${q}%,phone.like.%${digits}%`) : query.ilike("name", `%${q}%`);
      const { data } = await query.order("created_at", { ascending: false });
      results = (data ?? []) as Customer[];
    }
    return (
      <div>
        <div className="panel-head"><h1>계약 등록 <span className="sub">1단계 · 계약자</span></h1></div>
        <div className="p-4 max-w-[720px] grid gap-4">
          <form method="get" className="card p-4 flex gap-2 items-end">
            <div className="flex-1">
              <label className="label" htmlFor="q">계약자 이름 또는 전화번호</label>
              <input id="q" name="q" defaultValue={q} className="field" placeholder="예: 김서연 / 0101234" autoFocus />
            </div>
            <button className="btn btn-primary">찾기</button>
          </form>
          {q && (
            <div className="card overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>이름</th><th>전화</th><th>주소</th><th></th></tr></thead>
                <tbody>
                  {results.map((c) => (
                    <tr key={c.id}>
                      <td className="font-semibold">{c.name}</td>
                      <td className="mono">{phone(c.phone)}</td>
                      <td className="text-muted">{c.address ?? "—"}</td>
                      <td><Link href={`/contracts/new?customer=${c.id}`} className="btn btn-sm">이 계약자로</Link></td>
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr><td colSpan={4} className="text-muted">{canAddCustomer ? "찾는 고객이 없습니다. 아래에서 새 고객을 바로 등록할 수 있습니다." : <>찾는 고객이 없습니다. <Link href="/people/customers">고객 등록</Link> 뒤 다시 찾아 주세요.</>}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {!q && <p className="text-xs text-muted">{canAddCustomer ? "먼저 계약자를 찾습니다. 처음 오신 고객은 아래에서 바로 등록하고 계약을 이어서 작성할 수 있습니다." : <>먼저 계약자를 찾습니다. 새 고객은 <Link href="/people/customers">고객 화면</Link>에서 등록한 뒤 여기서 고릅니다.</>}</p>}
          {canAddCustomer && (
            // 박람회·현장용: 고객 화면을 거치지 않고 바로 등록 → 등록 즉시 2단계(계약 내용)로 넘어간다
            <ActionForm action={createCustomerForContract} className="card p-4 grid gap-3">
              <h2 className="text-sm font-semibold">새 고객 바로 등록 <span className="text-xs font-normal text-muted">박람회·현장용 — 등록하면 바로 계약 작성으로 넘어갑니다</span></h2>
              <input type="hidden" name="branch_id" value={session.current.branch_id ?? ""} />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="form-row">
                  <label className="label" htmlFor="new_customer_name">이름<span className="req">*</span></label>
                  <input id="new_customer_name" name="name" required maxLength={40} className="field" placeholder="고객 이름" defaultValue={q && !/\d/.test(q) ? q : ""} />
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="new_customer_phone">전화</label>
                  <input id="new_customer_phone" name="phone" inputMode="tel" maxLength={30} className="field mono" placeholder="010-0000-0000" defaultValue={q && /^[\d-]+$/.test(q) ? q : ""} />
                </div>
                <div className="form-row">
                  <label className="label" htmlFor="new_customer_address">주소</label>
                  <input id="new_customer_address" name="address" maxLength={200} className="field" placeholder="단지·주소 (선택)" />
                </div>
              </div>
              <div><SubmitButton className="btn btn-primary">등록하고 계약 작성</SubmitButton></div>
            </ActionForm>
          )}
        </div>
      </div>
    );
  }

  // 2단계: 계약 내용
  const [{ data: customer }, { data: sites }, { data: branches }, { data: partners }, { data: members }, intakeTypes, workAreas, { data: products }, { data: technicians }] = await Promise.all([
    supabase.from("customer").select("id, name, phone, address, branch_id, source_code, referrer_partner_id").eq("id", customerId).maybeSingle(),
    supabase.from("site").select("id, name, address, dong, ho").eq("customer_id", customerId).is("deleted_at", null).order("created_at"),
    supabase.from("branch").select("id, name, is_hq").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("is_hq", { ascending: false }).order("name"),
    supabase.from("partner").select("id, name, types").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("name"),
    supabase.from("membership").select("profile_id, profile:profile(display_name)").eq("tenant_id", tid).eq("status", "active"),
    codeValues(tid, "intake_type"),
    codeValues(tid, "work_area"),
    supabase.from("product").select("id, code, name, kind, work_area_code, unit, price, technician_rate").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("sort_order").order("name"),
    session.can("job.assign")
      ? supabase.from("technician").select("id, name, skills").eq("tenant_id", tid).eq("status", "active").is("deleted_at", null).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string; skills: string[] }[] }),
  ]);
  if (!customer) {
    return <div className="p-4 text-sm text-muted">고객을 찾지 못했습니다. <Link href="/contracts/new">다시 찾기</Link></div>;
  }
  const c = customer as Customer;
  const memberList = (members ?? []) as unknown as { profile_id: string; profile: { display_name: string } | null }[];
  const productList = (products ?? []) as { id: string; code: string; name: string; kind: string; work_area_code: string | null; unit: string; price: number; technician_rate: number }[];
  const techList = (technicians ?? []) as { id: string; name: string; skills: string[] }[];
  const canRate = session.can("payout.read") || session.can("product.manage");
  const today = new Date().toISOString().slice(0, 10);
  const defaultBranch = session.current.branch_id ?? c.branch_id ?? (branches ?? []).find((b) => b.is_hq)?.id ?? "";

  return (
    <div>
      <div className="panel-head">
        <h1>계약 등록 <span className="sub">2단계 · {c.name} {phone(c.phone)}</span></h1>
        <Link href="/contracts/new" className="btn btn-sm">계약자 다시 고르기</Link>
      </div>
      <ActionForm action={createContract} className="p-4 grid gap-4 max-w-[1100px]">
        <input type="hidden" name="customer_id" value={c.id} />

        <section className="card p-4 grid gap-3 md:grid-cols-3">
          <h2 className="md:col-span-3 text-sm font-semibold">계약 정보</h2>
          <div className="form-row">
            <label className="label" htmlFor="contract_date">계약일</label>
            <input id="contract_date" name="contract_date" type="date" defaultValue={today} className="field mono" />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="branch_id">지점</label>
            <select id="branch_id" name="branch_id" defaultValue={defaultBranch} className="field">
              <option value="">지점 없음</option>
              {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="intake_type_code">접수 형태</label>
            <select id="intake_type_code" name="intake_type_code" className="field" defaultValue="">
              <option value="">선택</option>
              {intakeTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="partner_id">발주처 (협력업체 발주 건)</label>
            <select id="partner_id" name="partner_id" className="field" defaultValue={c.referrer_partner_id ?? ""}>
              <option value="">없음 (직접 계약)</option>
              {(partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            {session.current.scope === "own" ? (
              // own 범위는 자기 계약만 가질 수 있다(다른 담당은 DB 가 거부) → 본인으로 고정
              <>
                <span className="label">영업 담당</span>
                <div className="field bg-bg text-muted flex items-center">{session.profile?.display_name ?? session.user.email ?? "본인"}</div>
                <input type="hidden" name="sales_owner_id" value={session.user.id} />
              </>
            ) : (
              <>
                <label className="label" htmlFor="sales_owner_id">영업 담당</label>
                <select id="sales_owner_id" name="sales_owner_id" className="field" defaultValue={session.user.id}>
                  {memberList.map((m) => <option key={m.profile_id} value={m.profile_id}>{m.profile?.display_name ?? m.profile_id}</option>)}
                </select>
              </>
            )}
          </div>
          <div className="form-row md:col-span-3">
            <label className="label" htmlFor="memo">메모</label>
            <input id="memo" name="memo" maxLength={1000} className="field" />
          </div>
        </section>

        <section className="card p-4 grid gap-3">
          <h2 className="text-sm font-semibold">현장</h2>
          <div className="grid gap-2">
            {(sites ?? []).map((s, i) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="radio" name="site_id" value={s.id} defaultChecked={i === 0} />
                <span className="font-medium">{s.name}</span>
                <span className="text-muted">{[s.address, s.dong && `${s.dong}동`, s.ho && `${s.ho}호`].filter(Boolean).join(" ")}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="site_id" value="" defaultChecked={(sites ?? []).length === 0} />
              <span>새 현장</span>
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <input name="new_site_name" placeholder="단지명 (새 현장일 때)" maxLength={80} className="field md:col-span-2" defaultValue={(sites ?? []).length === 0 ? (c.address ?? "") : ""} />
            <input name="new_site_dong" placeholder="동" maxLength={10} className="field mono" />
            <input name="new_site_ho" placeholder="호" maxLength={10} className="field mono" />
            <input name="new_site_address" placeholder="주소" maxLength={160} className="field md:col-span-4" />
          </div>
        </section>

        <section className="card overflow-x-auto">
          <div className="panel-head"><h2>품목 <span className="sub">체크한 품목이 계약에 들어갑니다</span></h2></div>
          <table className="tbl">
            <thead>
              <tr>
                <th></th>
                <th>상품</th>
                <th>작업 단위</th>
                <th>단위</th>
                <th className="text-right">단가</th>
                <th className="text-right">수량</th>
                <th className="text-right">할인</th>
                {canRate && <th className="text-right">기사비</th>}
              </tr>
            </thead>
            <tbody>
              {productList.map((p) => {
                const key = `p:${p.id}`;
                const wa = workAreas.find((w) => w.code === p.work_area_code);
                const waIdx = workAreas.findIndex((w) => w.code === p.work_area_code);
                return (
                  <tr key={p.id}>
                    <td><input type="checkbox" name={`line_${key}`} aria-label={`${p.name} 선택`} /></td>
                    <td>
                      <input type="hidden" name={`name_${key}`} value={p.name} />
                      <input type="hidden" name={`wa_${key}`} value={p.work_area_code ?? ""} />
                      <span className="font-semibold">{p.name}</span> <span className="mono text-xs text-muted">{p.code}</span>
                      {p.kind === "package" && <span className="badge badge-run ml-1">패키지</span>}
                    </td>
                    <td>
                      {wa ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`mark mark-${workAreaClass(wa.color, waIdx)}`}>{wa.label.slice(0, 1)}</span>{wa.label}
                        </span>
                      ) : <span className="zero">—</span>}
                    </td>
                    <td>{p.unit}</td>
                    <td><input name={`price_${key}`} defaultValue={won(p.price)} className="field mono text-right w-[120px]" /></td>
                    <td><input name={`qty_${key}`} type="number" step="0.01" min="0.01" defaultValue={1} className="field mono text-right w-[72px]" /></td>
                    <td><input name={`discount_${key}`} defaultValue="0" className="field mono text-right w-[100px]" /></td>
                    {canRate ? <td><input name={`rate_${key}`} defaultValue={won(p.technician_rate)} className="field mono text-right w-[110px]" /></td>
                             : <input type="hidden" name={`rate_${key}`} value={p.technician_rate} />}
                  </tr>
                );
              })}
              {[1, 2].map((n) => {
                const key = `m${n}`;
                return (
                  <tr key={key}>
                    <td><input type="checkbox" name={`line_${key}`} aria-label={`직접 입력 ${n} 선택`} /></td>
                    <td><input name={`name_${key}`} placeholder="직접 입력 품목명" maxLength={80} className="field" /></td>
                    <td>
                      <select name={`wa_${key}`} className="field" defaultValue="">
                        <option value="">작업 단위 없음</option>
                        {workAreas.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                      </select>
                    </td>
                    <td className="text-muted">식</td>
                    <td><input name={`price_${key}`} defaultValue="0" className="field mono text-right w-[120px]" /></td>
                    <td><input name={`qty_${key}`} type="number" step="0.01" min="0.01" defaultValue={1} className="field mono text-right w-[72px]" /></td>
                    <td><input name={`discount_${key}`} defaultValue="0" className="field mono text-right w-[100px]" /></td>
                    {canRate ? <td><input name={`rate_${key}`} defaultValue="0" className="field mono text-right w-[110px]" /></td> : <input type="hidden" name={`rate_${key}`} value="0" />}
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={canRate ? 8 : 7}>상품 {productList.length}개 · 금액은 저장 뒤 계약 상세에서 다시 계산됩니다</td></tr></tfoot>
          </table>
        </section>

        <section className="card overflow-x-auto">
          <div className="panel-head"><h2>시공 건 <span className="sub">체크한 품목의 작업 단위마다 시공 건이 하나씩 만들어집니다</span></h2></div>
          <table className="tbl">
            <thead><tr><th>작업 단위</th><th>예정일</th><th>시간대</th>{techList.length > 0 && <th>담당 기사</th>}</tr></thead>
            <tbody>
              {[...workAreas.map((w, i) => ({ key: w.code, label: w.label, color: workAreaClass(w.color, i), code: w.code })), { key: "none", label: "작업 단위 없는 품목", color: "", code: "" }].map((w) => (
                <tr key={w.key}>
                  <td>
                    {w.color ? <span className="inline-flex items-center gap-1.5"><span className={`mark mark-${w.color}`}>{w.label.slice(0, 1)}</span>{w.label}</span> : <span className="text-muted">{w.label}</span>}
                  </td>
                  <td><input type="date" name={`date_${w.key}`} className="field mono w-[160px]" /></td>
                  <td>
                    <select name={`slot_${w.key}`} className="field w-[100px]" defaultValue="any">
                      <option value="any">무관</option><option value="am">오전</option><option value="pm">오후</option>
                    </select>
                  </td>
                  {techList.length > 0 && (
                    <td>
                      <select name={`tech_${w.key}`} className="field w-[160px]" defaultValue="">
                        <option value="">미배정</option>
                        {techList.filter((t) => !w.code || t.skills.length === 0 || t.skills.includes(w.code)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="flex gap-2">
          <SubmitButton className="btn btn-primary btn-lg">계약 저장</SubmitButton>
          <Link href="/contracts" className="btn btn-lg">취소</Link>
        </div>
      </ActionForm>
    </div>
  );
}
