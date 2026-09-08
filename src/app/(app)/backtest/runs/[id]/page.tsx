import { notFound } from "next/navigation";
import { Page } from "@/components/shell/page";
import { SectionHead, Panel, PanelHeader, PanelBody, Stat, StatRow, Badge } from "@/components/ui";
import { Percent } from "@/components/ui/value";
import { formatMoney, formatR } from "@/lib/metrics/formatters";
import { requireUser } from "@/lib/session";
import { getRun } from "@/lib/queries/backtests";
import { EquityChart } from "@/components/charts/equity-chart";
import type { EquityPointDTO } from "@/lib/queries/analytics";
import { RunTradeTable } from "@/components/backtest/run-trade-table";
import { ViewInAnalyticsButton } from "@/components/backtest/view-in-analytics-button";

function toneOf(n: number | null): "profit" | "loss" | "neutral" {
  if (n === null || Math.abs(n) < 0.005) return "neutral";
  return n > 0 ? "profit" : "loss";
}

function formatDateRange(fromIso: string, toIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit", year: "numeric" };
  return `${new Date(fromIso).toLocaleDateString("en-US", opts)} – ${new Date(toIso).toLocaleDateString("en-US", opts)}`;
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const run = await getRun(user.id, id);
  if (!run) notFound();

  const s = run.summary;
  const equityData: EquityPointDTO[] = run.equity.map((p) => ({
    at: new Date(p.ts).toISOString(),
    balance: p.balance,
    change: 0,
    kind: "TRADE",
  }));

  return (
    <Page>
      <SectionHead
        title={run.label ?? run.symbol}
        hint={
          <>
            <Badge tone={run.kind === "STRATEGY" ? "brand" : "neutral"} className="mr-1.5">
              {run.kind}
            </Badge>
            {run.symbol} · {run.timeframe} · {formatDateRange(run.fromTs, run.toTs)}
            {run.strategy ? <> · strategy: {run.strategy.name}</> : null}
          </>
        }
        actions={<ViewInAnalyticsButton accountId={run.accountId} />}
      />

      {run.error ? (
        <Panel>
          <PanelBody>
            <p className="text-sm text-loss">
              This run ended with an error: <span className="mono text-xs">{run.error}</span>
              {run.trades.length > 0 ? " Trades made before the error are still recorded below." : null}
            </p>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Summary" />
        <PanelBody>
          <StatRow>
            <Stat label="Net P&L" value={formatMoney(s.netPnl, run.currency)} tone={toneOf(s.netPnl)} />
            <Stat label="Win rate" value={<Percent value={s.winRate} />} />
            <Stat label="Profit factor" value={s.profitFactor !== null ? s.profitFactor.toFixed(2) : "—"} />
            <Stat label="Expectancy" value={formatR(s.expectancyR)} tone={toneOf(s.expectancyR)} />
            <Stat
              label="Max drawdown"
              value={s.maxDrawdownAmount !== null ? formatMoney(-Math.abs(s.maxDrawdownAmount), run.currency) : "—"}
              hint={s.maxDrawdownPct !== null ? `${s.maxDrawdownPct.toFixed(1)}% of peak` : undefined}
              tone={s.maxDrawdownAmount ? "loss" : "neutral"}
            />
            <Stat label="Trades" value={String(s.tradeCount)} hint={`${s.wins}W / ${s.losses}L / ${s.breakevens} BE`} />
          </StatRow>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Equity curve" />
        <PanelBody className="h-72">
          <EquityChart data={equityData} startBalance={Number(run.initialBalance)} currency={run.currency} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Fill assumptions" caption="what this run treated as realistic execution" />
        <PanelBody>
          <StatRow>
            <Stat label="Initial balance" value={formatMoney(Number(run.initialBalance), run.currency)} />
            <Stat label="Spread" value={`${run.fill.spreadPoints} pts`} hint="charged on entry and exit" />
            <Stat label="Slippage" value={`${run.fill.slippagePoints} pts`} hint="against the trader, every fill" />
            <Stat
              label="Commission"
              value={formatMoney(Number(run.fill.commissionPerLot), run.currency)}
              hint="per lot, per side"
            />
            <Stat
              label="Same-bar stop+target"
              value={run.fill.pessimisticFills ? "Stop wins" : "Target wins"}
              hint={run.fill.pessimisticFills ? "the honest default" : "optimistic — sensitivity check only"}
            />
            <Stat label="Bars processed" value={s.barsProcessed.toLocaleString()} />
          </StatRow>
        </PanelBody>
      </Panel>

      {run.strategy ? (
        <Panel>
          <PanelHeader title="Strategy parameters" caption={run.strategy.name} />
          <PanelBody>
            {run.params && Object.keys(run.params).length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
                {Object.entries(run.params).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-line-faint pb-1">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="mono text-ink">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-ink-3">This strategy declares no parameters.</p>
            )}
          </PanelBody>
        </Panel>
      ) : null}

      <Panel flush>
        <PanelHeader title="Trades" caption={`${run.trades.length} trade(s)`} />
        <RunTradeTable trades={run.trades} currency={run.currency} />
      </Panel>
    </Page>
  );
}
