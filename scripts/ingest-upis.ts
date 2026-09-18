/**
 * UPIS → Bronze(stg) 적재 스켈레톤.
 *
 * 원본 스키마를 아직 확보하지 못했으므로, 각 원본 1행을 JSONB(payload)로
 * 손실 없이 StgRecord에 적재한다. 실제 UPIS 접근 경로가 확정되면
 * `readSource()`만 해당 어댑터(덤프/직접접속/CSV)로 교체하면 된다.
 *
 * 사용:  npx tsx scripts/ingest-upis.ts --source dump --object 계약
 */
import { prisma } from "../lib/prisma";

type SourceRow = { pk: string; data: Record<string, unknown> };

/**
 * 원본 어댑터 (TODO: UPIS 확보 방식에 맞게 구현)
 *  - dump   : 복원된 DB 또는 파싱된 덤프에서 조회
 *  - db     : UPIS_DATABASE_URL 로 직접 접속 (read-only)
 *  - csv    : 내보내기 CSV/엑셀 파싱
 */
async function readSource(
  _source: string,
  _object: string
): Promise<SourceRow[]> {
  // 스키마 확보 전까지는 빈 배열. 확정 후 실제 조회로 대체.
  return [];
}

async function ingest(source: string, object: string): Promise<void> {
  const batch = await prisma.stgBatch.create({
    data: { sourceSystem: "UPIS", sourceObject: object, status: "RUNNING" },
  });

  try {
    const rows = await readSource(source, object);

    for (const row of rows) {
      await prisma.stgRecord.upsert({
        where: {
          sourceObject_sourcePk_batchId: {
            sourceObject: object,
            sourcePk: row.pk,
            batchId: batch.id,
          },
        },
        create: {
          batchId: batch.id,
          sourceObject: object,
          sourcePk: row.pk,
          payload: row.data as object,
        },
        update: { payload: row.data as object },
      });
    }

    await prisma.stgBatch.update({
      where: { id: batch.id },
      data: { status: "SUCCEEDED", rowCount: rows.length, finishedAt: new Date() },
    });

    console.log(`[ingest] ${object}: ${rows.length} rows → batch ${batch.id}`);
  } catch (err) {
    await prisma.stgBatch.update({
      where: { id: batch.id },
      data: { status: "FAILED", finishedAt: new Date(), note: String(err) },
    });
    throw err;
  }
}

function parseArgs(argv: string[]): { source: string; object: string } {
  const get = (flag: string, def: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  return { source: get("--source", "dump"), object: get("--object", "계약") };
}

async function main() {
  const { source, object } = parseArgs(process.argv.slice(2));
  await ingest(source, object);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
