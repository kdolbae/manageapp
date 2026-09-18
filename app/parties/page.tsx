import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { partyTypeLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function PartiesPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q?.trim();
  const parties = await prisma.party.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    include: { _count: { select: { contracts: true, contacts: true } } },
    take: 200,
  });

  return (
    <div>
      <div className="page-head">
        <h1>거래처</h1>
        <Link className="btn primary" href="/parties/new">
          + 새 거래처
        </Link>
      </div>

      <form className="toolbar" method="get">
        <input name="q" placeholder="거래처명 검색" defaultValue={q ?? ""} style={{ maxWidth: 280 }} />
        <button className="btn" type="submit">
          검색
        </button>
        {q && (
          <Link className="btn" href="/parties">
            초기화
          </Link>
        )}
      </form>

      <div className="card">
        {parties.length === 0 ? (
          <p className="muted">거래처가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>거래처명</th>
                <th>식별번호</th>
                <th className="right">계약</th>
                <th className="right">담당자</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Badge tone={p.type === "COMPANY" ? "blue" : "gray"}>
                      {partyTypeLabel[p.type]}
                    </Badge>
                  </td>
                  <td>
                    <Link href={`/parties/${p.id}`}>{p.name}</Link>
                  </td>
                  <td className="muted">{p.regNo ? maskRegNo(p.regNo) : "-"}</td>
                  <td className="right">{p._count.contracts}</td>
                  <td className="right">{p._count.contacts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** 식별번호(PII) 마스킹 */
function maskRegNo(v: string): string {
  if (v.length <= 4) return "****";
  return v.slice(0, 3) + "*".repeat(Math.max(0, v.length - 5)) + v.slice(-2);
}
