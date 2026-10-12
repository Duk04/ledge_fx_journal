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

  if (!activeAccountId) {
    return (
      <Page width="reading">
        <SectionHead title="Import statement" />
        <Panel>
          <PanelBody>
            <EmptyState title="No trading account yet" description="Create a trading account to import into." />
          </PanelBody>
        </Panel>
      </Page>
    );
  }

  const account = await requireAccountAccess(activeAccountId);
  const [instruments, recent] = await Promise.all([listInstruments(), listRecentImports(user.id, account.id)]);

  return (
    <Page>
      <SectionHead
        title="Import statement"
        hint="MetaTrader 4/5 or CSV. Nothing is written until you confirm the preview."
      />
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
