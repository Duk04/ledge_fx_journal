import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { SectionHead } from "@/components/ui/panel";
import { requireAccountAccess, requireUser } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import { listInstruments, listTagsForUser } from "@/lib/queries/trades";
import { TradeForm } from "@/components/trades/trade-form";
import { uploadsAvailable } from "@/lib/storage";
import { listPlaybookOptions } from "@/lib/queries/playbooks";
import { EmptyState } from "@/components/ui/empty";
import { Panel, PanelBody } from "@/components/ui/panel";

export default async function NewTradePage() {
  const user = await requireUser();
  const t = await getTranslations("trades.form");
  const activeAccountId = await resolveActiveAccountId(user.id);

  if (!activeAccountId) {
    return (
      <Page width="reading">
        <SectionHead title={t("logTrade")} />
        <Panel>
          <PanelBody>
            <EmptyState title={t("page.noAccountTitle")} description={t("page.noAccountDescription")} />
          </PanelBody>
        </Panel>
      </Page>
    );
  }

  const account = await requireAccountAccess(activeAccountId);
  const [instruments, tags, playbooks] = await Promise.all([
    listInstruments(),
    listTagsForUser(user.id),
    listPlaybookOptions(user.id),
  ]);

  return (
    <Page width="reading">
      <SectionHead title={t("logTrade")} hint={t("page.recordedAgainst", { account: account.label })} />
      <TradeForm
        uploadsEnabled={uploadsAvailable()}
        mode="create"
        accountId={account.id}
        instruments={instruments}
        tags={tags}
        currency={account.currency}
        playbooks={playbooks}
      />
    </Page>
  );
}
