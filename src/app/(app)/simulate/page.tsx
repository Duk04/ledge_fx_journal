import { redirect } from "next/navigation";
import { Page } from "@/components/shell/page";
import { SectionHead } from "@/components/ui";
import { SimulatorView } from "@/components/simulate/simulator-view";
import { resolveActiveAccountId } from "@/lib/active-account";
import { simulationInputs } from "@/lib/queries/analytics";
import { requireAccountAccess, requireUser } from "@/lib/session";

export default async function SimulatePage() {
  const user = await requireUser();
  const accountId = await resolveActiveAccountId(user.id);
  if (!accountId) redirect("/accounts");
  const account = await requireAccountAccess(accountId);
  const inputs = await simulationInputs(user.id, account.id);

  return (
    <Page>
      <SectionHead
        title="Simulate"
        hint={`${account.label} — your own closed trades, replayed. Nothing here changes your journal.`}
      />
      <SimulatorView inputs={inputs} />
    </Page>
  );
}
