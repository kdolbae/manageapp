import { PartyForm } from "../PartyForm";
import { createParty } from "../actions";

export const dynamic = "force-dynamic";

export default function NewPartyPage() {
  return (
    <div>
      <div className="page-head">
        <h1>새 거래처</h1>
      </div>
      <div className="card">
        <PartyForm action={createParty} />
      </div>
    </div>
  );
}
