import { notFound } from "next/navigation";
import { Page } from "@/components/shell/page";
import { SectionHead } from "@/components/ui/panel";
import { requireUser } from "@/lib/session";
import { getTrade, listInstruments, listTagsForUser } from "@/lib/queries/trades";
import { TradeForm, isoToDatetimeLocal, type TradeFormInput } from "@/components/trades/trade-form";

export default async function EditTradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const trade = await getTrade(user.id, id);
  if (!trade) notFound();

  const [instruments, tags] = await Promise.all([listInstruments(), listTagsForUser(user.id)]);

  const defaults: Partial<TradeFormInput> = {
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.status as TradeFormInput["status"],
    openedAt: isoToDatetimeLocal(trade.openedAt),
    closedAt: isoToDatetimeLocal(trade.closedAt),
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice ?? "",
    stopLoss: trade.stopLoss ?? "",
    takeProfit: trade.takeProfit ?? "",
    volumeLots: trade.volumeLots,
    commission: trade.commission !== "0" ? trade.commission : "",
    swap: trade.swap !== "0" ? trade.swap : "",
    conversionRate: trade.conversionRate ?? "",
    followedPlan: trade.followedPlan === null ? "" : trade.followedPlan ? "yes" : "no",
    emotion: trade.emotion !== null ? String(trade.emotion) : "",
    confidence: trade.confidence !== null ? String(trade.confidence) : "",
    notes: trade.notes ?? "",
    tagIds: trade.tags.map((t) => t.id),
  };

  return (
    <Page width="reading">
      <SectionHead title={`Edit ${trade.symbol}`} hint={`Opened ${new Date(trade.openedAt).toLocaleString()}`} />
      <TradeForm
        mode="edit"
        accountId={trade.accountId}
        tradeId={trade.id}
        instruments={instruments}
        tags={tags}
        currency={trade.currency}
        defaults={defaults}
      />
    </Page>
  );
}
