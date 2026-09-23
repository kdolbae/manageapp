import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues, labelOf } from "@/lib/codes";
import { phone } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { archiveCustomer, createSite, deleteSite, updateCustomer, updateSite } from "@/lib/actions/people";
import { branchOptions, complexOptions, ensureOption, memberOptions, partnerOptions } from "../../data";
import { Crumb, KV, NoPermission } from "../../shared";
import { CustomerFields } from "../customer-fields";
import { SiteFields } from "../site-fields";

export const metadata = { title: "고객 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  memo: string | null;
  source_code: string | null;
  referrer_partner_id: string | null;
  marketing_consent: boolean;
  tags: string[];
  owner_id: string | null;
  branch_id: string | null;
  created_at: string;
  owner: { display_name: string } | null;
  branch: { name: string } | null;
  referrer: { name: string } | null;
};

type Site = {
  id: string;
  complex_id: string | null;
  name: string;
  address: string | null;
  dong: string | null;
  ho: string | null;
  unit_type: string | null;
  move_in_date: string | null;
  memo: string | null;
  complex: { name: string } | null;
};

function dongHo(s: Site) {
  const parts = [s.dong && `${s.dong}동`, s.ho && `${s.ho}호`].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export default async function CustomerPage({ params }: PageProps<"/people/customers/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  if (!session.can("customer.read")) return <NoPermission what="고객" />;
  const tid = session.current.tenant_id;
  const supabase = await createClient();

  const { data } = await supabase
    .from("customer")
    .select(
      "id, name, phone, phone2, email, address, memo, source_code, referrer_partner_id, marketing_consent, tags, owner_id, branch_id, created_at, " +
        "owner:profile!owner_id(display_name), branch:branch(name), referrer:partner!referrer_partner_id(name)",
    )
    .eq("id", id)
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  const c = data as unknown as Customer;
  const editable = session.can("customer.write");

  const [{ data: siteRows }, sources, partners, branches, members, complexes] = await Promise.all([
    supabase
      .from("site")
      .select("id, complex_id, name, address, dong, ho, unit_type, move_in_date, memo, complex:complex(name)")
      .eq("customer_id", id)
      .eq("tenant_id", tid)
      .is("deleted_at", null)
      .order("created_at"),
    codeValues(tid, "customer_source"),
    editable ? partnerOptions(supabase, tid, ["referrer", "orderer"]) : [],
    editable ? branchOptions(supabase, tid) : [],
    editable ? memberOptions(supabase, tid) : [],
    editable ? complexOptions(supabase, tid) : [],
  ]);
  const sites = (siteRows ?? []) as unknown as Site[];
  ensureOption(partners, c.referrer_partner_id, c.referrer?.name);
  ensureOption(branches, c.branch_id, c.branch?.name);
  ensureOption(members, c.owner_id, c.owner?.display_name);
  const owner = {
    id: session.user.id,
    name: session.profile?.display_name || session.user.email || "나",
    locked: session.current.scope === "own",
  };
  const tags = c.tags ?? [];

  return (
    <div>
      <Crumb href="/people/customers" parent="고객" current={c.name} />
      <div className={"grid gap-4 items-start" + (editable ? " lg:grid-cols-[1fr_340px]" : "")}>
        <div className="grid gap-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h2 className="text-base font-semibold">{c.name}</h2>
              {c.marketing_consent ? (
                <span className="badge badge-done">마케팅 동의</span>
              ) : (
                <span className="badge badge-wait">마케팅 미동의</span>
              )}
              {tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
            <KV k="전화">
              {c.phone ? <span className="mono">{phone(c.phone)}</span> : <span className="text-muted">—</span>}
              {c.phone2 && <span className="mono text-muted ml-2">{phone(c.phone2)}</span>}
            </KV>
            <KV k="이메일">{c.email ?? <span className="text-muted">—</span>}</KV>
            <KV k="주소">{c.address ?? <span className="text-muted">—</span>}</KV>
            <KV k="유입 경로">
              {labelOf(sources, c.source_code) || <span className="text-muted">—</span>}
              {c.referrer && <span className="text-muted ml-2">소개처: {c.referrer.name}</span>}
            </KV>
            <KV k="담당 · 지점">
              {c.owner?.display_name ?? "담당자 없음"} · {c.branch?.name ?? "본사 공통"}
            </KV>
            <KV k="등록일">
              <span className="mono">{c.created_at.slice(0, 10)}</span>
            </KV>
            {c.memo && (
              <KV k="메모">
                <span className="whitespace-pre-wrap">{c.memo}</span>
              </KV>
            )}
          </div>

          <div className="card overflow-x-auto">
            <div className="panel-head">
              <h2>
                현장 <span className="sub">{sites.length}곳</span>
              </h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>현장</th>
                  <th>주소</th>
                  <th>동 · 호</th>
                  <th>평형/타입</th>
                  <th>입주일</th>
                  <th>메모</th>
                  {editable && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold">
                      {s.name}
                      {s.complex && s.complex.name !== s.name && (
                        <div className="text-xs text-muted font-normal">{s.complex.name}</div>
                      )}
                    </td>
                    <td className="text-muted">{s.address ?? "—"}</td>
                    <td className="mono">{dongHo(s) ?? <span className="zero">—</span>}</td>
                    <td>{s.unit_type ?? <span className="zero">—</span>}</td>
                    <td className="mono text-muted">{s.move_in_date ?? "—"}</td>
                    <td className="text-muted max-w-[200px] truncate">{s.memo ?? ""}</td>
                    {editable && (
                      <td>
                        <details>
                          <summary className="cursor-pointer text-accent text-xs">수정</summary>
                          <ActionForm action={updateSite} className="mt-2 grid gap-1 min-w-[280px]">
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="customer_id" value={c.id} />
                            <SiteFields v={s} complexes={complexes} idPrefix={`site-${s.id}`} />
                            <SubmitButton className="btn btn-sm">저장</SubmitButton>
                          </ActionForm>
                          <form action={deleteSite} className="mt-3">
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="customer_id" value={c.id} />
                            <button className="btn btn-sm btn-danger">현장 삭제</button>
                          </form>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
                {sites.length === 0 && (
                  <tr>
                    <td colSpan={editable ? 7 : 6} className="text-center text-muted py-5">
                      등록된 현장이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {editable && (
            <ActionForm action={createSite} className="card p-4">
              <h2 className="text-sm font-semibold mb-3">현장 추가</h2>
              <input type="hidden" name="customer_id" value={c.id} />
              <div className="grid sm:grid-cols-2 gap-x-3">
                <SiteFields v={{}} complexes={complexes} idPrefix="site-new" twoCol />
              </div>
              <SubmitButton className="btn">현장 추가</SubmitButton>
            </ActionForm>
          )}
        </div>

        {editable && (
          <div className="grid gap-4">
            <ActionForm action={updateCustomer} className="card p-4">
              <h2 className="text-sm font-semibold mb-3">고객 정보 수정</h2>
              <input type="hidden" name="id" value={c.id} />
              <CustomerFields
                v={c}
                sources={sources}
                partners={partners}
                branches={branches}
                members={members}
                owner={owner}
                idPrefix="cust"
              />
              <div className="form-row">
                <label className="label" htmlFor="cust-tags">태그 (쉼표로 구분)</label>
                <input id="cust-tags" name="tags" maxLength={500} defaultValue={tags.join(", ")} placeholder="예: VIP, 재시공" className="field" />
              </div>
              <SubmitButton>저장</SubmitButton>
            </ActionForm>

            <div className="card p-4">
              <details>
                <summary className="cursor-pointer text-sm text-danger">고객 보관…</summary>
                <p className="text-xs text-muted mt-2 mb-3">
                  보관하면 고객 목록과 검색에서 사라집니다. 데이터는 지워지지 않고 계약·이력에는 그대로 남습니다.
                </p>
                <form action={archiveCustomer}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn btn-sm btn-danger">보관 확정</button>
                </form>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
