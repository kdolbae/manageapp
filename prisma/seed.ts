/**
 * 시드: 데모 데이터(거래처/계약/정산) + 데이터 자산 카탈로그.
 * 멱등하도록 고정 키(email/code/party regNo, asset key)로 upsert 한다.
 */
import { prisma } from "../lib/prisma";

async function seedUsers() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@jipdarie.local" },
    update: {},
    create: { email: "admin@jipdarie.local", name: "관리자", role: "ADMIN" },
  });
  await prisma.user.upsert({
    where: { email: "member@jipdarie.local" },
    update: {},
    create: { email: "member@jipdarie.local", name: "담당자", role: "MEMBER" },
  });
  return admin;
}

async function seedParties() {
  const acme = await prisma.party.upsert({
    where: { sourceSystem_sourcePk: { sourceSystem: "SEED", sourcePk: "P-1" } },
    update: {},
    create: {
      type: "COMPANY",
      name: "(주)아크메",
      regNo: "123-45-67890",
      address: "서울시 강남구",
      sourceSystem: "SEED",
      sourcePk: "P-1",
      ingestedAt: new Date(),
      contacts: {
        create: [{ name: "김담당", role: "구매팀장", email: "buyer@acme.example", phone: "02-000-0000" }],
      },
    },
  });
  const beta = await prisma.party.upsert({
    where: { sourceSystem_sourcePk: { sourceSystem: "SEED", sourcePk: "P-2" } },
    update: {},
    create: {
      type: "COMPANY",
      name: "베타파트너스",
      regNo: "987-65-43210",
      address: "경기도 성남시",
      sourceSystem: "SEED",
      sourcePk: "P-2",
      ingestedAt: new Date(),
    },
  });
  return { acme, beta };
}

async function seedContracts(acmeId: string, betaId: string) {
  const soon = new Date();
  soon.setDate(soon.getDate() + 20);
  const past = new Date();
  past.setDate(past.getDate() - 10);
  const start = new Date();
  start.setMonth(start.getMonth() - 6);

  await prisma.contract.upsert({
    where: { code: "CT-2026-0001" },
    update: {},
    create: {
      code: "CT-2026-0001",
      title: "클라우드 인프라 운영 계약",
      status: "ACTIVE",
      counterpartyId: acmeId,
      startDate: start,
      endDate: soon,
      autoRenew: true,
      noticePeriodDays: 30,
      currency: "KRW",
      totalAmount: 36000000,
      items: {
        create: [
          { name: "서버 운영", quantity: 12, unitPrice: 2000000, amount: 24000000 },
          { name: "모니터링", quantity: 12, unitPrice: 1000000, amount: 12000000 },
        ],
      },
      events: {
        create: [
          { type: "CREATED", memo: "계약 생성", occurredAt: start },
          { type: "SIGNED", memo: "양사 체결" },
        ],
      },
      settlements: {
        create: [
          { kind: "INVOICE", amount: 3000000, status: "OVERDUE", dueDate: past },
          { kind: "INVOICE", amount: 3000000, status: "PENDING", dueDate: soon },
        ],
      },
    },
  });

  await prisma.contract.upsert({
    where: { code: "CT-2026-0002" },
    update: {},
    create: {
      code: "CT-2026-0002",
      title: "SW 라이선스 공급 계약",
      status: "SIGNED",
      counterpartyId: betaId,
      startDate: new Date(),
      autoRenew: false,
      currency: "KRW",
      totalAmount: 8000000,
      events: { create: { type: "CREATED", memo: "계약 생성" } },
      settlements: { create: { kind: "PAYMENT", amount: 8000000, status: "PAID", paidDate: new Date() } },
    },
  });
}

async function seedCatalog(ownerId: string) {
  await prisma.dataAsset.upsert({
    where: { key: "core.contract" },
    update: { ownerId },
    create: {
      key: "core.contract",
      name: "계약(Contract)",
      description: "UPIS에서 이관된 표준 계약 데이터셋",
      layer: "SILVER",
      sourceSystem: "UPIS",
      refreshCadence: "ON_DEMAND",
      ownerId,
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
          { name: "계약번호 필수", rule: "code IS NOT NULL", dimension: "COMPLETENESS", lastStatus: "PASS", passRate: 100 },
          { name: "계약번호 유일", rule: "unique(code)", dimension: "UNIQUENESS", lastStatus: "PASS", passRate: 100 },
          { name: "총액 비음수", rule: "totalAmount IS NULL OR totalAmount >= 0", dimension: "VALIDITY", lastStatus: "PASS", passRate: 100 },
        ],
      },
    },
  });

  await prisma.dataAsset.upsert({
    where: { key: "core.party" },
    update: { ownerId },
    create: {
      key: "core.party",
      name: "거래처/당사자(Party)",
      description: "계약 당사자(법인/개인) 표준 데이터셋",
      layer: "SILVER",
      sourceSystem: "UPIS",
      refreshCadence: "ON_DEMAND",
      ownerId,
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
        create: [{ name: "상호 필수", rule: "name IS NOT NULL", dimension: "COMPLETENESS", lastStatus: "PASS", passRate: 100 }],
      },
    },
  });
}

async function main() {
  const admin = await seedUsers();
  const { acme, beta } = await seedParties();
  await seedContracts(acme.id, beta.id);
  await seedCatalog(admin.id);
  console.log("[seed] 데모 데이터 + 자산 카탈로그 초기화 완료");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
