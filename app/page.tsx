import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { formatMoney, formatDate, daysUntil } from "@/lib/format";
import {
  contractStatusLabel,
  contractStatusTone,
  eventTypeLabel,
  settlementStatusLabel,
  settlementStatusTone,
  settlementKindLabel,
} from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);

  const [total, active, expiringSoon, overdue, expiring, overdueList, recentEvents] =
    await Promise.all([
      prisma.contract.count(),
      prisma.contract.count({ where: { status: { in: ["ACTIVE", "RENEWED", "SIGNED"] } } }),
      prisma.contract.count({
        where: {
          status: { in: ["ACTIVE", "RENEWED", "SIGNED"] },
          endDate: { lte: soon, gte: new Date() },
        },
      }),
      prisma.settlement.count({ where: { status: "OVERDUE" } }),
      prisma.contract.findMany({
        where: {
          status: { in: ["ACTIVE", "RENEWED", "SIGNED"] },
          endDate: { lte: soon, gte: new Date() },
        },
        orderBy: { endDate: "asc" },
        take: 8,
        include: { counterparty: true },
      }),
      prisma.settlement.findMany({
        where: { status: { in: ["OVERDUE", "PENDING"] } },
        orderBy: { dueDate: "asc" },
        take: 8,
        include: { contract: true },
      }),
      prisma.contractEvent.findMany({
        orderBy: { occurredAt: "desc" },
        take: 8,
        include: { contract: true },
      }),
    ]);

  return (
    <div>
      <div className="page-head">
        <h1>대시보드</h1>
        <Link className="btn primary" href="/contracts/new">
          + 새 계약
        </Link>
      </div>

      <div className="grid cols-4">
        <div className="card kpi">
          <div className="value">{total}</div>
          <div className="label">전체 계약</div>
        </div>
        <div className="card kpi">
          <div className="value">{active}</div>
          <div className="label">활성 계약</div>
        </div>
        <div className="card kpi">
          <div className="value" style={{ color: expiringSoon ? "var(--blue)" : undefined }}>
            {expiringSoon}
          </div>
          <div className="label">30일 내 만료</div>
        </div>
        <div className="card kpi">
          <div className="value" style={{ color: overdue ? "var(--red)" : undefined }}>
            {overdue}
          </div>
          <div className="label">연체 정산</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>만료 임박 계약 (30일)</h2>
          {expiring.length === 0 ? (
            <p className="muted">임박한 계약이 없습니다.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>계약</th>
                  <th>거래처</th>
                  <th className="right">만료</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((c) => {
                  const d = daysUntil(c.endDate);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/contracts/${c.id}`}>{c.title}</Link>
                      </td>
                      <td className="muted">{c.counterparty?.name ?? "-"}</td>
                      <td className="right">
                        {formatDate(c.endDate)}
                        <br />
                        <span className="muted" style={{ fontSize: 12 }}>
                          D-{d}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>미수/연체 정산</h2>
          {overdueList.length === 0 ? (
            <p className="muted">대기중인 정산이 없습니다.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>계약</th>
                  <th>구분</th>
                  <th className="right">금액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {overdueList.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/contracts/${s.contractId}`}>{s.contract.title}</Link>
                    </td>
                    <td className="muted">{settlementKindLabel[s.kind]}</td>
                    <td className="right">{formatMoney(s.amount, s.currency)}</td>
                    <td>
                      <Badge tone={settlementStatusTone[s.status]}>
                        {settlementStatusLabel[s.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>최근 활동</h2>
        {recentEvents.length === 0 ? (
          <p className="muted">활동 내역이 없습니다.</p>
        ) : (
          <ul className="timeline">
            {recentEvents.map((e) => (
              <li key={e.id}>
                <Link href={`/contracts/${e.contractId}`}>{e.contract.title}</Link>{" "}
                <Badge tone={contractStatusTone[e.type] ?? "gray"}>
                  {eventTypeLabel[e.type] ?? e.type}
                </Badge>
                <span className="muted"> · {formatDate(e.occurredAt)}</span>
                {e.memo ? <div className="muted">{e.memo}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
