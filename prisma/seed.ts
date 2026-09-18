/**
 * 데이터 자산 카탈로그 시드.
 * 표준 코어 엔터티를 '데이터 자산'으로 등록하고, 데이터 사전·계보·품질 검증을 초기화한다.
 */
import { prisma } from "../lib/prisma";

async function main() {
  // 예: core.Contract 를 하나의 데이터 자산으로 등록
  const contractAsset = await prisma.dataAsset.upsert({
    where: { key: "core.contract" },
    update: {},
    create: {
      key: "core.contract",
      name: "계약(Contract)",
      description: "UPIS에서 이관된 표준 계약 데이터셋",
      layer: "SILVER",
      sourceSystem: "UPIS",
      refreshCadence: "ON_DEMAND",
      fields: {
        create: [
          { name: "code", dataType: "string", description: "계약번호", isRequired: true },
          { name: "title", dataType: "string", description: "계약명", isRequired: true },
          { name: "status", dataType: "enum", description: "계약 상태" },
          { name: "totalAmount", dataType: "decimal", description: "계약 총액" },
          { name: "counterpartyId", dataType: "string", description: "거래처 참조" },
        ],
      },
      lineage: {
        create: [
          {
            sourceSystem: "UPIS",
            sourceObject: "계약",
            transform: "stg.StgRecord(payload) → core.Contract upsert(by sourcePk)",
          },
        ],
      },
      qualityChecks: {
        create: [
          {
            name: "계약번호 필수",
            rule: "code IS NOT NULL",
            dimension: "COMPLETENESS",
          },
          {
            name: "계약번호 유일",
            rule: "unique(code)",
            dimension: "UNIQUENESS",
          },
          {
            name: "총액 비음수",
            rule: "totalAmount IS NULL OR totalAmount >= 0",
            dimension: "VALIDITY",
          },
        ],
      },
    },
  });

  // 거래처 자산
  await prisma.dataAsset.upsert({
    where: { key: "core.party" },
    update: {},
    create: {
      key: "core.party",
      name: "거래처/당사자(Party)",
      description: "계약 당사자(법인/개인) 표준 데이터셋",
      layer: "SILVER",
      sourceSystem: "UPIS",
      refreshCadence: "ON_DEMAND",
      fields: {
        create: [
          { name: "name", dataType: "string", description: "상호/성명", isRequired: true },
          { name: "regNo", dataType: "string", description: "사업자/식별번호", isPii: true },
        ],
      },
      lineage: {
        create: [
          {
            sourceSystem: "UPIS",
            sourceObject: "거래처",
            transform: "stg.StgRecord(payload) → core.Party upsert(by sourcePk)",
          },
        ],
      },
      qualityChecks: {
        create: [
          { name: "상호 필수", rule: "name IS NOT NULL", dimension: "COMPLETENESS" },
        ],
      },
    },
  });

  console.log(`[seed] 자산 카탈로그 초기화 완료 (기준 자산: ${contractAsset.key})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
