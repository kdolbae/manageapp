import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PartyForm } from "../../PartyForm";
import { updateParty } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditPartyPage({ params }: { params: { id: string } }) {
  const party = await prisma.party.findUnique({ where: { id: params.id } });
  if (!party) notFound();
  const action = updateParty.bind(null, party.id);

  return (
    <div>
      <div className="page-head">
        <h1>거래처 수정</h1>
      </div>
      <div className="card">
        <PartyForm action={action} party={party} />
      </div>
    </div>
  );
}
