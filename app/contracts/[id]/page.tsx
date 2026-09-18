import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { formatMoney, formatDate } from "@/lib/format";
import {
  contractStatusLabel,
  contractStatusTone,
  contractTransitions,
  eventTypeLabel,
  documentKindLabel,
  settlementKindLabel,
  settlementStatusLabel,
  settlementStatusTone,
} from "@/lib/labels";
import {
  changeStatus,
  addItem,
  deleteItem,
  addDocument,
  addSettlement,
  createRevision,
} from "../actions";
import { updateSettlementStatus } from "@/app/settlements/actions";

export const dynamic = "force-dynamic";

export default async function ContractDetail({ params }: { params: { id: string } }) {
  const c = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      counterparty: true,
      parent: true,
      revisions: true,
      items: true,
      documents: { orderBy: { uploadedAt: "desc" } },
      events: { orderBy: { occurredAt: "desc" } },
      settlements: { orderBy: { dueDate: "asc" } },
    },
  });
  if (!c) notFound();

  const transitions = contractTransitions[c.status] ?? [];
  const path = `/contracts/${c.id}`;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{c.title}</h1>
          <div className="muted">
            {c.code}
            {c.parent && (
              <>
                {" · 원계약 "}
                <Link href={`/contracts/${c.parent.id}`}>{c.parent.code}</Link>
              </>
            )}
          </div>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <Badge tone={contractStatusTone[c.status]}>{contractStatusLabel[c.status]}</Badge>
          <Link className="btn" href={`${path}/edit`}>
            수정
          </Link>
          <form action={createRevision.bind(null, c.id)}>
            <button className="btn" type="submit">
              변경계약 생성
            </button>
          </form>
        </div>
      </div>

      {/* 상태 전이 */}
      {transitions.length > 0 && (
        <div className="card">
          <h2>상태 전환</h2>
          <div className="inline-form">
            {transitions.map((t) => (
              <form key={t} action={changeStatus.bind(null, c.id, t)}>
                <button className="btn sm" type="submit">
                  → {contractStatusLabel[t]}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      <div className="grid cols-2">
        {/* 기본 정보 */}
        <div className="card">
          <h2>기본 정보</h2>
          <dl className="dl">
            <dt>거래처</dt>
            <dd>
              {c.counterparty ? (
                <Link href={`/parties/${c.counterparty.id}`}>{c.counterparty.name}</Link>
              ) : (
                "-"
              )}
            </dd>
            <dt>기간</dt>
            <dd>
              {formatDate(c.startDate)} ~ {formatDate(c.endDate)}
            </dd>
            <dt>총액</dt>
            <dd>{formatMoney(c.totalAmount, c.currency)}</dd>
            <dt>자동갱신</dt>
            <dd>{c.autoRenew ? "예" : "아니오"}</dd>
            <dt>통지기한</dt>
            <dd>{c.noticePeriodDays ? `${c.noticePeriodDays}일` : "-"}</dd>
            {c.sourceSystem && (
              <>
                <dt>원본</dt>
                <dd className="muted">
                  {c.sourceSystem} · {c.sourcePk}
                </dd>
              </>
            )}
          </dl>
          {c.revisions.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>변경계약</h3>
              <ul>
                {c.revisions.map((r) => (
                  <li key={r.id}>
                    <Link href={`/contracts/${r.id}`}>
                      {r.code} · {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* 이벤트 타임라인 */}
        <div className="card">
          <h2>활동 이력</h2>
          {c.events.length === 0 ? (
            <p className="muted">이력이 없습니다.</p>
          ) : (
            <ul className="timeline">
              {c.events.map((e) => (
                <li key={e.id}>
                  <Badge tone={contractStatusTone[e.type] ?? "gray"}>
                    {eventTypeLabel[e.type] ?? e.type}
                  </Badge>{" "}
                  <span className="muted">{formatDate(e.occurredAt)}</span>
                  {e.memo && <div className="muted">{e.memo}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 품목 */}
      <div className="card">
        <h2>품목 / 조건</h2>
        {c.items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>품목</th>
                <th className="right">수량</th>
                <th className="right">단가</th>
                <th className="right">금액</th>
                <th>비고</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td className="right">{it.quantity ? String(it.quantity) : "-"}</td>
                  <td className="right">{formatMoney(it.unitPrice, c.currency)}</td>
                  <td className="right">{formatMoney(it.amount, c.currency)}</td>
                  <td className="muted">{it.note ?? "-"}</td>
                  <td className="right">
                    <form action={deleteItem.bind(null, c.id, it.id)}>
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
        <form action={addItem.bind(null, c.id)} className="inline-form" style={{ marginTop: 12 }}>
          <input name="name" placeholder="품목명" required />
          <input name="quantity" type="number" step="0.0001" placeholder="수량" />
          <input name="unitPrice" type="number" step="0.01" placeholder="단가" />
          <input name="amount" type="number" step="0.01" placeholder="금액(선택)" />
          <input name="note" placeholder="비고" />
          <button className="btn sm primary" type="submit">
            품목 추가
          </button>
        </form>
      </div>

      {/* 정산 */}
      <div className="card">
        <h2>정산</h2>
        {c.settlements.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th className="right">금액</th>
                <th>마감</th>
                <th>상태</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {c.settlements.map((s) => (
                <tr key={s.id}>
                  <td>{settlementKindLabel[s.kind]}</td>
                  <td className="right">{formatMoney(s.amount, s.currency)}</td>
                  <td className="muted">{formatDate(s.dueDate)}</td>
                  <td>
                    <Badge tone={settlementStatusTone[s.status]}>
                      {settlementStatusLabel[s.status]}
                    </Badge>
                  </td>
                  <td>
                    <div className="inline-form">
                      {s.status !== "PAID" && (
                        <form
                          action={updateSettlementStatus.bind(null, s.id, "PAID", path)}
                        >
                          <button className="btn sm" type="submit">
                            완료
                          </button>
                        </form>
                      )}
                      {s.status !== "CANCELED" && s.status !== "PAID" && (
                        <form
                          action={updateSettlementStatus.bind(null, s.id, "CANCELED", path)}
                        >
                          <button className="btn sm" type="submit">
                            취소
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          action={addSettlement.bind(null, c.id)}
          className="inline-form"
          style={{ marginTop: 12 }}
        >
          <select name="kind" defaultValue="INVOICE">
            <option value="INVOICE">청구</option>
            <option value="RECEIPT">수납</option>
            <option value="PAYMENT">지급</option>
          </select>
          <input name="amount" type="number" step="0.01" placeholder="금액" required />
          <input name="dueDate" type="date" />
          <button className="btn sm primary" type="submit">
            정산 추가
          </button>
        </form>
      </div>

      {/* 문서 */}
      <div className="card">
        <h2>문서</h2>
        {c.documents.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>파일</th>
                <th>등록일</th>
              </tr>
            </thead>
            <tbody>
              {c.documents.map((d) => (
                <tr key={d.id}>
                  <td>{documentKindLabel[d.kind]}</td>
                  <td>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer">
                        {d.fileName}
                      </a>
                    ) : (
                      d.fileName
                    )}
                  </td>
                  <td className="muted">{formatDate(d.uploadedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          action={addDocument.bind(null, c.id)}
          className="inline-form"
          style={{ marginTop: 12 }}
        >
          <select name="kind" defaultValue="CONTRACT">
            <option value="CONTRACT">계약서</option>
            <option value="ATTACHMENT">첨부</option>
            <option value="AMENDMENT">변경계약서</option>
            <option value="OTHER">기타</option>
          </select>
          <input name="fileName" placeholder="파일명" required />
          <input name="url" placeholder="URL / 경로 (선택)" />
          <button className="btn sm primary" type="submit">
            문서 등록
          </button>
        </form>
      </div>
    </div>
  );
}
