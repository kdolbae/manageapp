import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { formatMoney, formatDate, daysUntil } from "@/lib/format";
import { settlementKindLabel, settlementStatusLabel, settlementStatusTone } from "@/lib/labels";
import { updateSettlementStatus, markOverdue } from "./actions";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES = ["PENDING", "PARTIAL", "PAID", "OVERDUE", "CANCELED"];

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status = searchParams.status?.trim();
  const where: Prisma.SettlementWhereInput = {};
  if (status && STATUSES.includes(status)) where.status = status as any;

  const [settlements, sums] = await Promise.all([
    prisma.settlement.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      include: { contract: { include: { counterparty: true } } },
      take: 200,
    }),
    prisma.settlement.groupBy({ by: ["status"], _sum: { amount: true }, _count: true }),
  ]);

  const outstanding = sums
    .filter((s) => s.status === "PENDING" || s.status === "PARTIAL" || s.status === "OVERDUE")
    .reduce((acc, s) => acc + Number(s._sum.amount ?? 0), 0);

  return (
    <div>
      <div className="page-head">
        <h1>정산</h1>
        <form action={markOverdue}>
          <button className="btn" type="submit">
            연체 일괄 반영
          </button>
        </form>
      </div>

      <div className="grid cols-4">
        <div className="card kpi">
          <div className="value">{formatMoney(outstanding)}</div>
          <div className="label">미수/미지급 합계</div>
        </div>
        {["OVERDUE", "PENDING", "PAID"].map((st) => {
          const row = sums.find((s) => s.status === st);
          return (
            <div className="card kpi" key={st}>
              <div className="value">{row?._count ?? 0}</div>
              <div className="label">{settlementStatusLabel[st]}</div>
            </div>
          );
        })}
      </div>

      <form className="toolbar" method="get">
        <select name="status" defaultValue={status ?? ""}>
          <option value="">전체 상태</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {settlementStatusLabel[s]}
            </option>
          ))}
        </select>
        <button className="btn" type="submit">
          필터
        </button>
        {status && (
          <Link className="btn" href="/settlements">
            초기화
          </Link>
        )}
      </form>

      <div className="card">
        {settlements.length === 0 ? (
          <p className="muted">정산 내역이 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>계약</th>
                <th>거래처</th>
                <th>구분</th>
                <th className="right">금액</th>
                <th>마감</th>
                <th>상태</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => {
                const d = s.status !== "PAID" && s.status !== "CANCELED" ? daysUntil(s.dueDate) : null;
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/contracts/${s.contractId}`}>{s.contract.title}</Link>
                    </td>
                    <td className="muted">{s.contract.counterparty?.name ?? "-"}</td>
                    <td>{settlementKindLabel[s.kind]}</td>
                    <td className="right">{formatMoney(s.amount, s.currency)}</td>
                    <td className="muted">
                      {formatDate(s.dueDate)}
                      {d !== null && (
                        <span style={{ color: d < 0 ? "var(--red)" : "var(--muted)", fontSize: 12 }}>
                          {" "}
                          {d < 0 ? `${-d}일 지남` : `D-${d}`}
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge tone={settlementStatusTone[s.status]}>
                        {settlementStatusLabel[s.status]}
                      </Badge>
                    </td>
                    <td>
                      {s.status !== "PAID" && s.status !== "CANCELED" && (
                        <form action={updateSettlementStatus.bind(null, s.id, "PAID", "/settlements")}>
                          <button className="btn sm" type="submit">
                            완료 처리
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
