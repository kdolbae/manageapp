import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { codeValues } from "@/lib/codes";
import { phone } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { updatePartner } from "@/lib/actions/people";
import { branchOptions, ensureOption } from "../../data";
import { CodeBadges, Crumb, KV, NoPermission, PARTNER_STATUS, StatusBadge, rateText } from "../../shared";
import { PartnerFields } from "../partner-fields";

export const metadata = { title: "협력업체 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Partner = {
  id: string;
  name: string;
  types: string[] | null;
  business_no: string | null;
  ceo_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  commission_rate: number | string | null;
  settlement_terms: string | null;
  memo: string | null;
  status: string;
  branch_id: string | null;
  created_at: string;
  branch: { name: string } | null;
};

export default async function PartnerPage({ params }: PageProps<"/people/partners/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireTenant();
  if (!session.can("partner.read")) return <NoPermission what="협력업체" />;
  const tid = session.current.tenant_id;
  const supabase = await createClient();

  const { data } = await supabase
    .from("partner")
    .select(
      "id, name, types, business_no, ceo_name, phone, email, address, contact_name, contact_phone, commission_rate, settlement_terms, memo, status, branch_id, created_at, branch:branch(name)",
    )
    .eq("id", id)
    .eq("tenant_id", tid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  const p = data as unknown as Partner;
  const editable = session.can("partner.write");

  const [types, branches] = await Promise.all([codeValues(tid, "partner_type"), editable ? branchOptions(supabase, tid) : []]);
  ensureOption(branches, p.branch_id, p.branch?.name);
  const dash = <span className="text-muted">—</span>;

  return (
    <div>
      <Crumb href="/people/partners" parent="협력업체" current={p.name} />
      <div className={"grid gap-4 items-start" + (editable ? " lg:grid-cols-[1fr_340px]" : " max-w-[720px]")}>
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="text-base font-semibold">{p.name}</h2>
            <StatusBadge status={p.status} labels={PARTNER_STATUS} />
          </div>
          <KV k="유형">
            <CodeBadges codes={p.types ?? []} values={types} />
          </KV>
          <KV k="사업자번호">{p.business_no ? <span className="mono">{p.business_no}</span> : dash}</KV>
          <KV k="대표자">{p.ceo_name ?? dash}</KV>
          <KV k="대표 전화">{p.phone ? <span className="mono">{phone(p.phone)}</span> : dash}</KV>
          <KV k="이메일">{p.email ?? dash}</KV>
          <KV k="주소">{p.address ?? dash}</KV>
          <KV k="담당자">
            {p.contact_name || p.contact_phone ? (
              <>
                {p.contact_name}
                {p.contact_phone && <span className="mono ml-2">{phone(p.contact_phone)}</span>}
              </>
            ) : (
              dash
            )}
          </KV>
          <KV k="수수료율">{rateText(p.commission_rate) || dash}</KV>
          <KV k="정산 조건">{p.settlement_terms ?? dash}</KV>
          <KV k="지점">{p.branch?.name ?? "본사 공통"}</KV>
          <KV k="등록일">
            <span className="mono">{p.created_at.slice(0, 10)}</span>
          </KV>
          {p.memo && (
            <KV k="메모">
              <span className="whitespace-pre-wrap">{p.memo}</span>
            </KV>
          )}
        </div>

        {editable && (
          <ActionForm action={updatePartner} className="card p-4">
            <h2 className="text-sm font-semibold mb-3">협력업체 정보 수정</h2>
            <input type="hidden" name="id" value={p.id} />
            <PartnerFields v={p} types={types} branches={branches} idPrefix="partner" />
            <div className="form-row">
              <label className="label" htmlFor="partner-status">상태</label>
              <select id="partner-status" name="status" defaultValue={p.status} className="field">
                <option value="active">거래 중</option>
                <option value="inactive">거래 중지</option>
              </select>
            </div>
            <SubmitButton>저장</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
