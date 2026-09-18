import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { formatMoney, formatDate } from "@/lib/format";
import { contractStatusLabel, contractStatusTone } from "@/lib/labels";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT", "REVIEW", "SIGNED", "ACTIVE", "RENEWED", "EXPIRED", "TERMINATED"];

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const q = searchParams.q?.trim();
  const status = searchParams.status?.trim();

  const where: Prisma.ContractWhereInput = {};
  if (status && STATUSES.includes(status)) where.status = status as any;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { counterparty: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const contracts = await prisma.contract.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { counterparty: true },
    take: 100,
  });

  return (
    <div>
      <div className="page-head">
        <h1>계약</h1>
        <Link className="btn primary" href="/contracts/new">
          + 새 계약
        </Link>
      </div>

      <form className="toolbar" method="get">
        <input
          type="text"
          name="q"
          placeholder="계약명 · 계약번호 · 거래처 검색"
          defaultValue={q ?? ""}
          style={{ maxWidth: 320 }}
        />
        <select name="status" defaultValue={status ?? ""}>
          <option value="">전체 상태</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {contractStatusLabel[s]}
            </option>
          ))}
        </select>
        <button className="btn" type="submit">
          검색
        </button>
        {(q || status) && (
          <Link className="btn" href="/contracts">
            초기화
          </Link>
        )}
      </form>

      <div className="card">
        {contracts.length === 0 ? (
          <p className="muted">계약이 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>계약번호</th>
                <th>계약명</th>
                <th>거래처</th>
                <th>상태</th>
                <th className="right">총액</th>
                <th>기간</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td className="muted">{c.code}</td>
                  <td>
                    <Link href={`/contracts/${c.id}`}>{c.title}</Link>
                    {c.parentId && <span className="muted"> (변경)</span>}
                  </td>
                  <td className="muted">{c.counterparty?.name ?? "-"}</td>
                  <td>
                    <Badge tone={contractStatusTone[c.status]}>
                      {contractStatusLabel[c.status]}
                    </Badge>
                  </td>
                  <td className="right">{formatMoney(c.totalAmount, c.currency)}</td>
                  <td className="muted">
                    {formatDate(c.startDate)} ~ {formatDate(c.endDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
