"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseString } from "@/lib/format";

export async function createParty(formData: FormData) {
  const p = await prisma.party.create({
    data: {
      type: (parseString(formData.get("type")) as any) ?? "COMPANY",
      name: parseString(formData.get("name")) ?? "이름 없음",
      regNo: parseString(formData.get("regNo")),
      address: parseString(formData.get("address")),
    },
  });
  revalidatePath("/parties");
  redirect(`/parties/${p.id}`);
}

export async function updateParty(id: string, formData: FormData) {
  await prisma.party.update({
    where: { id },
    data: {
      type: (parseString(formData.get("type")) as any) ?? "COMPANY",
      name: parseString(formData.get("name")) ?? "이름 없음",
      regNo: parseString(formData.get("regNo")),
      address: parseString(formData.get("address")),
    },
  });
  revalidatePath(`/parties/${id}`);
  redirect(`/parties/${id}`);
}

export async function addContact(partyId: string, formData: FormData) {
  await prisma.partyContact.create({
    data: {
      partyId,
      name: parseString(formData.get("name")) ?? "담당자",
      email: parseString(formData.get("email")),
      phone: parseString(formData.get("phone")),
      role: parseString(formData.get("role")),
    },
  });
  revalidatePath(`/parties/${partyId}`);
}

export async function deleteContact(partyId: string, contactId: string) {
  await prisma.partyContact.delete({ where: { id: contactId } });
  revalidatePath(`/parties/${partyId}`);
}
