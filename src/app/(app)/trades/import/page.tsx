import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { EmptyState, Panel, PanelBody, SectionHead } from "@/components/ui";
import { StatementImport } from "@/components/trades/statement-import";
import { resolveActiveAccountId } from "@/lib/active-account";
import { listInstruments } from "@/lib/queries/trades";
import { listRecentImports } from "@/lib/queries/statements";
import { requireAccountAccess, requireUser } from "@/lib/session";

export default async function ImportStatementPage() {
  const user = await requireUser();
  const activeAccountId = await resolveActiveAccountId(user.id);
  const t = await getTranslations("trades");

  if (!activeAccountId) {
    return (
      <Page width="reading">
        <SectionHead title={t("import.title")} />
        <Panel>
          <PanelBody>
            <EmptyState title={t("common.noAccountTitle")} description={t("import.noAccountDescription")} />
          </PanelBody>
        </Panel>
      </Page>
    );
  }

  const account = await requireAccountAccess(activeAccountId);
  const [instruments, recent] = await Promise.all([listInstruments(), listRecentImports(user.id, account.id)]);

  return (
    <Page>
      <SectionHead title={t("import.title")} hint={t("import.hint")} />
      <StatementImport
        accountId={account.id}
        accountLabel={`${account.label} (${account.currency})`}
        timezone={user.timezone}
        instruments={instruments.map((i) => ({ symbol: i.symbol, displayName: i.displayName }))}
        recent={recent}
      />
    </Page>
  );
}
