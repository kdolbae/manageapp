import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { assetLayerLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

const layerTone: Record<string, string> = { BRONZE: "gray", SILVER: "blue", GOLD: "green" };

export default async function AssetsPage() {
  const assets = await prisma.dataAsset.findMany({
    orderBy: [{ layer: "asc" }, { key: "asc" }],
    include: {
      owner: true,
      _count: { select: { fields: true, lineage: true, qualityChecks: true } },
    },
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>데이터 자산 카탈로그</h1>
          <p className="muted">계약 데이터를 표준·계보·품질을 갖춘 자산으로 관리합니다.</p>
        </div>
      </div>

      <div className="card">
        {assets.length === 0 ? (
          <p className="muted">
            등록된 자산이 없습니다. <code>npm run db:seed</code>로 기본 카탈로그를 초기화하세요.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>키</th>
                <th>이름</th>
                <th>계층</th>
                <th>원본</th>
                <th>소유자</th>
                <th className="right">필드</th>
                <th className="right">품질검증</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td className="muted">
                    <Link href={`/assets/${a.id}`}>{a.key}</Link>
                  </td>
                  <td>{a.name}</td>
                  <td>
                    <Badge tone={layerTone[a.layer] ?? "gray"}>{assetLayerLabel[a.layer]}</Badge>
                  </td>
                  <td className="muted">{a.sourceSystem ?? "-"}</td>
                  <td className="muted">{a.owner?.name ?? "-"}</td>
                  <td className="right">{a._count.fields}</td>
                  <td className="right">{a._count.qualityChecks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
