import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { SectionHead } from "@/components/ui";
import { PlaybooksView } from "@/components/playbooks/playbooks-view";
import { resolveActiveAccountId } from "@/lib/active-account";
import { listPlaybooks } from "@/lib/queries/playbooks";
import { requireAccountAccess, requireUser } from "@/lib/session";

export default async function PlaybooksPage() {
  const user = await requireUser();
  const accountId = await resolveActiveAccountId(user.id);
  if (!accountId) redirect("/accounts");
  const account = await requireAccountAccess(accountId);
  const playbooks = await listPlaybooks(user.id, account.id);
  const t = await getTranslations("playbooks");

  return (
    <Page>
      <SectionHead title={t("title")} hint={t("hint", { account: account.label })} />
      <PlaybooksView playbooks={playbooks} currency={account.currency} />
    </Page>
  );
}
