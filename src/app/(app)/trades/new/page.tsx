import { Page } from "@/components/shell/page";
import { SectionHead } from "@/components/ui/panel";
import { requireAccountAccess, requireUser } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import { listInstruments, listTagsForUser } from "@/lib/queries/trades";
import { TradeForm } from "@/components/trades/trade-form";
import { EmptyState } from "@/components/ui/empty";
import { Panel, PanelBody } from "@/components/ui/panel";

export default async function NewTradePage() {
  const user = await requireUser();
  const activeAccountId = await resolveActiveAccountId(user.id);

  if (!activeAccountId) {
    return (
      <Page width="reading">
        <SectionHead title="Log trade" />
        <Panel>
          <PanelBody>
            <EmptyState title="No trading account yet" description="Create a trading account before logging a trade." />
          </PanelBody>
        </Panel>
      </Page>
    );
  }

  const account = await requireAccountAccess(activeAccountId);
  const [instruments, tags] = await Promise.all([listInstruments(), listTagsForUser(user.id)]);

  return (
    <Page width="reading">
      <SectionHead title="Log trade" hint={`Recorded against ${account.label}`} />
      <TradeForm mode="create" accountId={account.id} instruments={instruments} tags={tags} currency={account.currency} />
    </Page>
  );
}
