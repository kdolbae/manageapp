import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ContractForm } from "../../ContractForm";
import { updateContract } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditContractPage({ params }: { params: { id: string } }) {
  const [contract, parties] = await Promise.all([
    prisma.contract.findUnique({ where: { id: params.id } }),
    prisma.party.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!contract) notFound();

  const action = updateContract.bind(null, contract.id);

  return (
    <div>
      <div className="page-head">
        <h1>계약 수정 · {contract.code}</h1>
      </div>
      <div className="card">
        <ContractForm parties={parties} action={action} contract={contract} />
      </div>
    </div>
  );
}
