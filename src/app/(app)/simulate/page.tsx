import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("simulate");

  return (
    <Page>
      <SectionHead title={t("title")} hint={t("hint", { account: account.label })} />
      <SimulatorView inputs={inputs} />
    </Page>
  );
}
