"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseDate, parseNumber, parseString } from "@/lib/format";
import { contractTransitions, statusEventType } from "@/lib/labels";

/** 계약번호 자동 생성: CT-YYYY-#### */
async function nextContractCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CT-${year}-`;
  const last = await prisma.contract.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const seq = last ? parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function createContract(formData: FormData) {
  const code = parseString(formData.get("code")) ?? (await nextContractCode());
  const created = await prisma.contract.create({
    data: {
      code,
      title: (parseString(formData.get("title")) ?? "제목 없음").slice(0, 200),
      status: (parseString(formData.get("status")) as any) ?? "DRAFT",
      counterpartyId: parseString(formData.get("counterpartyId")),
      startDate: parseDate(formData.get("startDate")),
      endDate: parseDate(formData.get("endDate")),
      autoRenew: formData.get("autoRenew") === "on",
      noticePeriodDays: parseNumber(formData.get("noticePeriodDays")) ?? undefined,
      currency: parseString(formData.get("currency")) ?? "KRW",
      totalAmount: parseNumber(formData.get("totalAmount")) ?? undefined,
      events: { create: { type: "CREATED", memo: "계약 생성" } },
    },
  });
  revalidatePath("/contracts");
  redirect(`/contracts/${created.id}`);
}

export async function updateContract(id: string, formData: FormData) {
  await prisma.contract.update({
    where: { id },
    data: {
      title: (parseString(formData.get("title")) ?? "제목 없음").slice(0, 200),
      counterpartyId: parseString(formData.get("counterpartyId")),
      startDate: parseDate(formData.get("startDate")),
      endDate: parseDate(formData.get("endDate")),
      autoRenew: formData.get("autoRenew") === "on",
      noticePeriodDays: parseNumber(formData.get("noticePeriodDays")) ?? undefined,
      currency: parseString(formData.get("currency")) ?? "KRW",
      totalAmount: parseNumber(formData.get("totalAmount")) ?? undefined,
    },
  });
  revalidatePath(`/contracts/${id}`);
  redirect(`/contracts/${id}`);
}

export async function changeStatus(id: string, next: string) {
  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) return;
  const allowed = contractTransitions[contract.status] ?? [];
  if (!allowed.includes(next)) return; // 잘못된 전이는 무시

  await prisma.$transaction([
    prisma.contract.update({ where: { id }, data: { status: next as any } }),
    prisma.contractEvent.create({
      data: {
        contractId: id,
        type: (statusEventType[next] as any) ?? "AMENDED",
        memo: `상태 변경: ${contract.status} → ${next}`,
      },
    }),
  ]);
  revalidatePath(`/contracts/${id}`);
}

export async function addItem(contractId: string, formData: FormData) {
  const quantity = parseNumber(formData.get("quantity"));
  const unitPrice = parseNumber(formData.get("unitPrice"));
  const amount =
    parseNumber(formData.get("amount")) ??
    (quantity !== null && unitPrice !== null ? quantity * unitPrice : null);
  await prisma.contractItem.create({
    data: {
      contractId,
      name: parseString(formData.get("name")) ?? "품목",
      quantity: quantity ?? undefined,
      unitPrice: unitPrice ?? undefined,
      amount: amount ?? undefined,
      note: parseString(formData.get("note")),
    },
  });
  revalidatePath(`/contracts/${contractId}`);
}

export async function deleteItem(contractId: string, itemId: string) {
  await prisma.contractItem.delete({ where: { id: itemId } });
  revalidatePath(`/contracts/${contractId}`);
}

export async function addDocument(contractId: string, formData: FormData) {
  await prisma.contractDocument.create({
    data: {
      contractId,
      kind: (parseString(formData.get("kind")) as any) ?? "OTHER",
      fileName: parseString(formData.get("fileName")) ?? "문서",
      url: parseString(formData.get("url")),
    },
  });
  revalidatePath(`/contracts/${contractId}`);
}

export async function addSettlement(contractId: string, formData: FormData) {
  await prisma.settlement.create({
    data: {
      contractId,
      kind: (parseString(formData.get("kind")) as any) ?? "INVOICE",
      amount: parseNumber(formData.get("amount")) ?? 0,
      currency: parseString(formData.get("currency")) ?? "KRW",
      dueDate: parseDate(formData.get("dueDate")),
    },
  });
  revalidatePath(`/contracts/${contractId}`);
}

/** 원계약을 복제하여 변경/부속계약(개정)을 생성 */
export async function createRevision(id: string) {
  const base = await prisma.contract.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!base) return;
  const code = (await nextContractCode()) + "-R";
  const rev = await prisma.contract.create({
    data: {
      code,
      title: `${base.title} (변경)`,
      status: "DRAFT",
      counterpartyId: base.counterpartyId,
      parentId: base.id,
      startDate: base.startDate,
      endDate: base.endDate,
      autoRenew: base.autoRenew,
      noticePeriodDays: base.noticePeriodDays,
      currency: base.currency,
      totalAmount: base.totalAmount ?? undefined,
      items: {
        create: base.items.map((it) => ({
          name: it.name,
          quantity: it.quantity ?? undefined,
          unitPrice: it.unitPrice ?? undefined,
          amount: it.amount ?? undefined,
          note: it.note,
        })),
      },
      events: { create: { type: "AMENDED", memo: `원계약 ${base.code} 기반 변경계약 생성` } },
    },
  });
  revalidatePath("/contracts");
  redirect(`/contracts/${rev.id}`);
}
