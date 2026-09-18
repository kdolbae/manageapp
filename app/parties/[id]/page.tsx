import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { formatMoney, formatDate } from "@/lib/format";
import { partyTypeLabel, contractStatusLabel, contractStatusTone } from "@/lib/labels";
import { addContact, deleteContact } from "../actions";

export const dynamic = "force-dynamic";

export default async function PartyDetail({ params }: { params: { id: string } }) {
  const p = await prisma.party.findUnique({
    where: { id: params.id },
    include: {
      contacts: true,
      contracts: { orderBy: { updatedAt: "desc" } },
    },
  });
  if (!p) notFound();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <Badge tone={p.type === "COMPANY" ? "blue" : "gray"}>{partyTypeLabel[p.type]}</Badge>
        </div>
        <Link className="btn" href={`/parties/${p.id}/edit`}>
          수정
        </Link>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>기본 정보</h2>
          <dl className="dl">
            <dt>식별번호</dt>
            <dd className="muted">{p.regNo ?? "-"}</dd>
            <dt>주소</dt>
            <dd>{p.address ?? "-"}</dd>
          </dl>
        </div>

        <div className="card">
          <h2>담당자</h2>
          {p.contacts.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>직책</th>
                  <th>연락처</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {p.contacts.map((ct) => (
                  <tr key={ct.id}>
                    <td>{ct.name}</td>
                    <td className="muted">{ct.role ?? "-"}</td>
                    <td className="muted">
                      {ct.email ?? "-"}
                      {ct.phone ? ` · ${ct.phone}` : ""}
                    </td>
                    <td className="right">
                      <form action={deleteContact.bind(null, p.id, ct.id)}>
                        <button className="btn sm danger" type="submit">
                          삭제
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form action={addContact.bind(null, p.id)} className="inline-form" style={{ marginTop: 12 }}>
            <input name="name" placeholder="이름" required />
            <input name="role" placeholder="직책" />
            <input name="email" placeholder="이메일" />
            <input name="phone" placeholder="전화" />
            <button className="btn sm primary" type="submit">
              추가
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2>계약 ({p.contracts.length})</h2>
        {p.contracts.length === 0 ? (
          <p className="muted">계약이 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>계약번호</th>
                <th>계약명</th>
                <th>상태</th>
                <th className="right">총액</th>
              </tr>
            </thead>
            <tbody>
              {p.contracts.map((c) => (
                <tr key={c.id}>
                  <td className="muted">{c.code}</td>
                  <td>
                    <Link href={`/contracts/${c.id}`}>{c.title}</Link>
                  </td>
                  <td>
                    <Badge tone={contractStatusTone[c.status]}>
                      {contractStatusLabel[c.status]}
                    </Badge>
                  </td>
                  <td className="right">{formatMoney(c.totalAmount, c.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
