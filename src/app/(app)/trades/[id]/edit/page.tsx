import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { SectionHead } from "@/components/ui/panel";
import { requireUser } from "@/lib/session";
import { getTrade, listInstruments, listTagsForUser } from "@/lib/queries/trades";
import { TradeForm } from "@/components/trades/trade-form";
import { AttachmentUploader } from "@/components/trades/attachment-uploader";
import { uploadsAvailable } from "@/lib/storage";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { listPlaybookOptions } from "@/lib/queries/playbooks";
// From the pure module, not the client component: a server page reaching
// into a "use client" file for a date helper pulls that whole module into
// the server graph.
import type { TradeFormInput } from "@/components/trades/trade-form-values";
import { formatInZone } from "@/lib/metrics/formatters";

export default async function EditTradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const t = await getTranslations("trades.form.page");
  const tDetail = await getTranslations("trades.detail");
  const trade = await getTrade(user.id, id);
  if (!trade) notFound();

  const [instruments, tags, playbooks] = await Promise.all([
    listInstruments(),
    listTagsForUser(user.id),
    listPlaybookOptions(user.id),
  ]);

  const defaults: Partial<TradeFormInput> = {
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.status as TradeFormInput["status"],
    // Stored ISO timestamps, converted to wall time in the browser by
    // defaultFormValues — see the comment there for why not here.
    openedAt: trade.openedAt,
    closedAt: trade.closedAt ?? "",
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice ?? "",
    stopLoss: trade.stopLoss ?? "",
    // Shown only when it differs: blank means "same as the stop loss".
    initialStopLoss: trade.initialStopLoss && trade.initialStopLoss !== trade.stopLoss ? trade.initialStopLoss : "",
    takeProfit: trade.takeProfit ?? "",
    maePrice: trade.maePrice ?? "",
    mfePrice: trade.mfePrice ?? "",
    volumeLots: trade.volumeLots,
    commission: trade.commission !== "0" ? trade.commission : "",
    swap: trade.swap !== "0" ? trade.swap : "",
    conversionRate: trade.conversionRate ?? "",
    followedPlan: trade.followedPlan === null ? "" : trade.followedPlan ? "yes" : "no",
    emotion: trade.emotion !== null ? String(trade.emotion) : "",
    confidence: trade.confidence !== null ? String(trade.confidence) : "",
    notes: trade.notes ?? "",
    tagIds: trade.tags.map((t) => t.id),
    playbookId: trade.playbook?.id ?? "",
  };

  return (
    <Page width="reading">
      <SectionHead
        title={t("editTitle", { symbol: trade.symbol })}
        hint={t("opened", { date: formatInZone(trade.openedAt, user.timezone, "EEE, MMM d yyyy · HH:mm") })}
      />
      <TradeForm
        mode="edit"
        accountId={trade.accountId}
        tradeId={trade.id}
        instruments={instruments}
        tags={tags}
        currency={trade.currency}
        fillsLocked={trade.multiFill}
        playbooks={
          trade.playbook && !playbooks.some((p) => p.id === trade.playbook!.id)
            ? [...playbooks, { id: trade.playbook.id, name: trade.playbook.name }]
            : playbooks
        }
        defaults={defaults}
      />
      {/* Beside the form, not inside it: each screenshot change saves on its
          own, so it must not wait for — or be lost with — the form's Save. */}
      <Panel className="mt-4">
        <PanelHeader title={tDetail("panels.screenshots")} />
        <PanelBody>
          <AttachmentUploader
            tradeId={trade.id}
            initialAttachments={trade.attachments}
            uploadsEnabled={uploadsAvailable()}
          />
        </PanelBody>
      </Panel>
    </Page>
  );
}
