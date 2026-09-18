"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseString } from "@/lib/format";

export async function createUser(formData: FormData) {
  const email = parseString(formData.get("email"));
  if (!email) return;
  await prisma.user.upsert({
    where: { email },
    update: {
      name: parseString(formData.get("name")) ?? email,
      role: (parseString(formData.get("role")) as any) ?? "MEMBER",
    },
    create: {
      email,
      name: parseString(formData.get("name")) ?? email,
      role: (parseString(formData.get("role")) as any) ?? "MEMBER",
    },
  });
  revalidatePath("/users");
}

export async function deleteUser(id: string) {
  await prisma.user.delete({ where: { id } });
  revalidatePath("/users");
}
