import { prisma } from "@/lib/prisma";
import { ContractForm } from "../ContractForm";
import { createContract } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewContractPage() {
  const parties = await prisma.party.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div>
      <div className="page-head">
        <h1>새 계약</h1>
      </div>
      <div className="card">
        <ContractForm parties={parties} action={createContract} isNew />
      </div>
    </div>
  );
}
