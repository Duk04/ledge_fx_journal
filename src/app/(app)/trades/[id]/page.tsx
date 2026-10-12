import type * as React from "react";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Page, Grid } from "@/components/shell/page";
import { Panel, PanelBody, PanelHeader, SectionHead } from "@/components/ui/panel";
import { DirectionBadge, Badge, SessionBadge, TagChip } from "@/components/ui/badge";
import { Money, Pips, RValue } from "@/components/ui/value";
import { formatDuration, formatInZone, formatPrice, formatR } from "@/lib/metrics/formatters";
import { requireUser } from "@/lib/session";
import { getTrade } from "@/lib/queries/trades";
import { PriceLadder } from "@/components/trades/price-ladder";
import { ScreenshotGallery } from "@/components/trades/screenshot-gallery";
import { TradeDetailActions } from "@/components/trades/detail-actions";
import { ExecutionsPanel } from "@/components/trades/executions-panel";
import { ChecklistPanel } from "@/components/trades/checklist-panel";
import { TradeChart } from "@/components/trades/trade-chart";
import { tradeChartBars } from "@/lib/queries/candles";
import { listPlaybookOptions } from "@/lib/queries/playbooks";
import { ExcursionFromCandlesButton } from "@/components/trades/excursion-button";

function outcomeOf(
  status: string,
  netPnl: string | null,
): { label: string; tone: "neutral" | "profit" | "loss" | "warn" } {
  if (status !== "CLOSED" || netPnl === null)
    return { label: status, tone: status === "CANCELLED" ? "warn" : "neutral" };
  const n = Number(netPnl);
  if (Math.abs(n) < 0.005) return { label: "BREAKEVEN", tone: "neutral" };
  return n > 0 ? { label: "WIN", tone: "profit" } : { label: "LOSS", tone: "loss" };
}

export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [trade, playbookOptions] = await Promise.all([getTrade(user.id, id), listPlaybookOptions(user.id)]);
  if (!trade) notFound();
  const chart = await tradeChartBars({
    symbol: trade.symbol,
    openedAt: new Date(trade.openedAt),
    closedAt: trade.closedAt ? new Date(trade.closedAt) : null,
  });

  const outcome = outcomeOf(trade.status, trade.netPnl);
  const openedAt = new Date(trade.openedAt);
  const closedAt = trade.closedAt ? new Date(trade.closedAt) : null;

  return (
    <Page>
      <SectionHead
        title={
          <span className="flex flex-wrap items-center gap-2">
            {trade.symbol}
            <DirectionBadge direction={trade.direction} />
            <Badge tone={outcome.tone}>{outcome.label}</Badge>
          </span>
        }
        hint={trade.displayName}
        actions={
          <TradeDetailActions
            accountId={trade.accountId}
            tradeId={trade.id}
            status={trade.status}
            openLots={trade.openLots}
          />
        }
      />

      {trade.hasDisagreement ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-panel)] border border-warn/30 bg-warn-weak px-3 py-2.5 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Stored numbers don&apos;t match a fresh recompute.</p>
            <p className="mt-0.5 text-warn/90">
              This can happen after a formula change or a manual database edit. Run{" "}
              <code className="mono rounded-inner bg-black/10 px-1 py-0.5">npm run backfill</code> to bring every
              trade&apos;s derived columns back in sync. Recomputed values are shown in parentheses below.
            </p>
          </div>
        </div>
      ) : null}

      <Grid>
        <div className="flex flex-col gap-4 lg:col-span-7">
          {chart ? (
            <Panel>
              <PanelHeader
                title="Chart"
                caption={`${chart.timeframe}${chart.aggregatedFrom ? ` (from ${chart.aggregatedFrom})` : ""}`}
              />
              <PanelBody padded={false} className="p-2">
                <TradeChart
                  bars={chart.bars}
                  digits={trade.digits}
                  direction={trade.direction}
                  executions={trade.executions}
                  stopLoss={trade.stopLoss !== null ? Number(trade.stopLoss) : null}
                  initialStopLoss={trade.initialStopLoss !== null ? Number(trade.initialStopLoss) : null}
                  takeProfit={trade.takeProfit !== null ? Number(trade.takeProfit) : null}
                />
              </PanelBody>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              title="Price geometry"
              caption={
                chart ? undefined : "import candles for this symbol (Backtest → Data) to see the trade on a chart"
              }
            />
            <PanelBody className="flex justify-center py-6">
              <PriceLadder
                direction={trade.direction}
                digits={trade.digits}
                entryPrice={Number(trade.entryPrice)}
                stopLoss={trade.stopLoss !== null ? Number(trade.stopLoss) : null}
                takeProfit={trade.takeProfit !== null ? Number(trade.takeProfit) : null}
                exitPrice={trade.exitPrice !== null ? Number(trade.exitPrice) : null}
              />
            </PanelBody>
          </Panel>

          <ExecutionsPanel
            accountId={trade.accountId}
            tradeId={trade.id}
            digits={trade.digits}
            timezone={user.timezone}
            executions={trade.executions}
            openLots={trade.openLots}
            cancelled={trade.status === "CANCELLED"}
          />

          <Panel>
            <PanelHeader title="Screenshots" />
            <PanelBody>
              <ScreenshotGallery attachments={trade.attachments} />
            </PanelBody>
          </Panel>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <Panel>
            <PanelHeader title="Facts" />
            <PanelBody className="flex flex-col gap-2">
              <FactRow label="Opened" value={formatInZone(openedAt, user.timezone, "EEE, MMM d yyyy · HH:mm")} />
              <FactRow label="Session" value={<SessionBadge session={trade.marketSession} />} />
              <FactRow
                label="Closed"
                value={closedAt ? formatInZone(closedAt, user.timezone, "EEE, MMM d yyyy · HH:mm") : "—"}
              />
              <FactRow label="Held" value={formatDuration(trade.holdingMinutes)} />
              <div className="my-1 h-px bg-line" />
              <FactRow label="Entry" value={formatPrice(Number(trade.entryPrice), trade.digits)} />
              <FactRow
                label="Exit"
                value={trade.exitPrice !== null ? formatPrice(Number(trade.exitPrice), trade.digits) : "—"}
              />
              <FactRow
                label="Stop loss"
                value={trade.stopLoss !== null ? formatPrice(Number(trade.stopLoss), trade.digits) : "—"}
              />
              {trade.initialStopLoss !== null && trade.initialStopLoss !== trade.stopLoss ? (
                // Shown only when the stop has moved: R is measured from this one.
                <FactRow label="Initial stop" value={formatPrice(Number(trade.initialStopLoss), trade.digits)} />
              ) : null}
              <FactRow
                label="Take profit"
                value={trade.takeProfit !== null ? formatPrice(Number(trade.takeProfit), trade.digits) : "—"}
              />
              <FactRow label="Volume" value={`${Number(trade.volumeLots).toFixed(2)} lots`} />
              <div className="my-1 h-px bg-line" />
              <FactRow
                label="Net P&L"
                value={<Money value={trade.netPnl} currency={trade.currency} signed />}
                recomputedValue={
                  trade.hasDisagreement ? (
                    <Money value={trade.recomputed.netPnl} currency={trade.currency} signed />
                  ) : undefined
                }
              />
              <FactRow
                label="Pips"
                value={<Pips value={trade.pips} />}
                recomputedValue={trade.hasDisagreement ? <Pips value={trade.recomputed.pips} /> : undefined}
              />
              <FactRow
                label="R multiple"
                value={<RValue value={trade.rMultiple} />}
                recomputedValue={trade.hasDisagreement ? <RValue value={trade.recomputed.rMultiple} /> : undefined}
              />
              <FactRow
                label="Planned R:R"
                value={trade.recomputed.plannedRR ? `${Number(trade.recomputed.plannedRR).toFixed(2)}:1` : "—"}
              />
              <FactRow
                label="Worst price (MAE)"
                value={
                  trade.maePrice !== null
                    ? `${formatPrice(Number(trade.maePrice), trade.digits)}${trade.maeR !== null ? ` · ${formatR(trade.maeR)}` : ""}`
                    : "—"
                }
              />
              <FactRow
                label="Best price (MFE)"
                value={
                  trade.mfePrice !== null
                    ? `${formatPrice(Number(trade.mfePrice), trade.digits)}${trade.mfeR !== null ? ` · ${formatR(trade.mfeR)}` : ""}`
                    : "—"
                }
              />
              {trade.status === "CLOSED" && (trade.maePrice === null || trade.mfePrice === null) ? (
                <div className="flex justify-end">
                  <ExcursionFromCandlesButton accountId={trade.accountId} tradeId={trade.id} />
                </div>
              ) : null}
              <FactRow label="Risk amount" value={<Money value={trade.riskAmount} currency={trade.currency} />} />
              <div className="my-1 h-px bg-line" />
              <FactRow
                label="Commission"
                value={<Money value={trade.commission} currency={trade.currency} colour={false} />}
              />
              <FactRow label="Swap" value={<Money value={trade.swap} currency={trade.currency} colour={false} />} />
            </PanelBody>
          </Panel>

          {trade.tags.length > 0 ? (
            <Panel>
              <PanelHeader title="Tags" />
              <PanelBody className="flex flex-wrap gap-1.5">
                {trade.tags.map((t) => (
                  <TagChip key={t.id} name={t.name} color={t.color} />
                ))}
              </PanelBody>
            </Panel>
          ) : null}

          <ChecklistPanel
            accountId={trade.accountId}
            tradeId={trade.id}
            playbook={trade.playbook}
            options={playbookOptions}
          />

          <Panel>
            <PanelHeader title="Discipline" />
            <PanelBody className="flex flex-col gap-2">
              <FactRow
                label="Followed plan"
                value={
                  trade.followedPlan === null ? (
                    "—"
                  ) : (
                    <Badge tone={trade.followedPlan ? "profit" : "warn"}>{trade.followedPlan ? "Yes" : "No"}</Badge>
                  )
                }
              />
              <FactRow label="Emotion" value={trade.emotion !== null ? `${trade.emotion} / 5` : "—"} />
              <FactRow label="Confidence" value={trade.confidence !== null ? `${trade.confidence} / 5` : "—"} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Notes" />
            <PanelBody>
              {trade.notes ? (
                <p className="whitespace-pre-wrap text-sm text-ink-2">{trade.notes}</p>
              ) : (
                <p className="text-xs text-ink-3">No notes on this trade.</p>
              )}
            </PanelBody>
          </Panel>
        </div>
      </Grid>
    </Page>
  );
}

function FactRow({
  label,
  value,
  recomputedValue,
}: {
  label: string;
  value: React.ReactNode;
  recomputedValue?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-ink-3">{label}</span>
      <span className="mono text-right text-ink">
        {value}
        {recomputedValue !== undefined ? (
          <span className="ml-1.5 text-2xs text-warn">(fresh: {recomputedValue})</span>
        ) : null}
      </span>
    </div>
  );
}
