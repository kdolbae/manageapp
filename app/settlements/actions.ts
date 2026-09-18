"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseDate } from "@/lib/format";

export async function updateSettlementStatus(id: string, status: string, redirectPath: string) {
  const data: any = { status };
  if (status === "PAID") data.paidDate = new Date();
  await prisma.settlement.update({ where: { id }, data });
  revalidatePath(redirectPath);
  revalidatePath("/settlements");
}

export async function setSettlementDue(id: string, formData: FormData, redirectPath: string) {
  await prisma.settlement.update({
    where: { id },
    data: { dueDate: parseDate(formData.get("dueDate")) },
  });
  revalidatePath(redirectPath);
}

/** 마감일이 지난 미납 정산을 OVERDUE로 일괄 반영 (배치/알림용) */
export async function markOverdue() {
  await prisma.settlement.updateMany({
    where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: new Date() } },
    data: { status: "OVERDUE" },
  });
  revalidatePath("/settlements");
}
