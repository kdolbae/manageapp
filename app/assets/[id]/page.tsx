import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { formatDate } from "@/lib/format";
import { assetLayerLabel, qualityDimensionLabel, qualityStatusTone } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AssetDetail({ params }: { params: { id: string } }) {
  const a = await prisma.dataAsset.findUnique({
    where: { id: params.id },
    include: { owner: true, fields: true, lineage: true, qualityChecks: true },
  });
  if (!a) notFound();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{a.name}</h1>
          <div className="muted">
            <code>{a.key}</code> · <Badge tone="blue">{assetLayerLabel[a.layer]}</Badge>
          </div>
        </div>
        <Link className="btn" href="/assets">
          목록
        </Link>
      </div>

      {a.description && <div className="card">{a.description}</div>}

      <div className="card">
        <h2>데이터 사전 (필드)</h2>
        {a.fields.length === 0 ? (
          <p className="muted">필드 정의가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>필드</th>
                <th>타입</th>
                <th>설명</th>
                <th>필수</th>
                <th>PII</th>
              </tr>
            </thead>
            <tbody>
              {a.fields.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td className="muted">{f.dataType}</td>
                  <td className="muted">{f.description ?? "-"}</td>
                  <td>{f.isRequired ? "●" : ""}</td>
                  <td>{f.isPii ? <Badge tone="red">PII</Badge> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>계보 (Lineage)</h2>
          {a.lineage.length === 0 ? (
            <p className="muted">계보 정보가 없습니다.</p>
          ) : (
            <ul className="timeline">
              {a.lineage.map((l) => (
                <li key={l.id}>
                  <strong>
                    {l.sourceSystem}.{l.sourceObject}
                  </strong>
                  <div className="muted">{l.transform ?? "-"}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatDate(l.recordedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>품질 검증</h2>
          {a.qualityChecks.length === 0 ? (
            <p className="muted">등록된 검증이 없습니다.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>검증</th>
                  <th>차원</th>
                  <th>결과</th>
                  <th className="right">통과율</th>
                </tr>
              </thead>
              <tbody>
                {a.qualityChecks.map((q) => (
                  <tr key={q.id}>
                    <td>
                      {q.name}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {q.rule}
                      </div>
                    </td>
                    <td className="muted">{qualityDimensionLabel[q.dimension]}</td>
                    <td>
                      {q.lastStatus ? (
                        <Badge tone={qualityStatusTone[q.lastStatus] ?? "gray"}>
                          {q.lastStatus}
                        </Badge>
                      ) : (
                        <span className="muted">미실행</span>
                      )}
                    </td>
                    <td className="right">{q.passRate != null ? `${q.passRate}%` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
