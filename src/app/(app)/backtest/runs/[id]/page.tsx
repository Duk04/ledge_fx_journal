import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("backtest");

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
              {t(`runKind.${run.kind}`)}
            </Badge>
            {run.symbol} · {run.timeframe} · {formatDateRange(run.fromTs, run.toTs)}
            {run.strategy ? <> · {t("run.strategyLabel", { name: run.strategy.name })}</> : null}
          </>
        }
        actions={<ViewInAnalyticsButton accountId={run.accountId} />}
      />

      {run.error ? (
        <Panel>
          <PanelBody>
            <p className="text-sm text-loss">
              {t.rich("run.endedWithError", {
                error: run.error,
                err: (chunks) => <span className="mono text-xs">{chunks}</span>,
              })}
              {run.trades.length > 0 ? ` ${t("run.tradesKept")}` : null}
            </p>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title={t("run.summary")} />
        <PanelBody>
          <StatRow>
            <Stat label={t("run.netPnl")} value={formatMoney(s.netPnl, run.currency)} tone={toneOf(s.netPnl)} />
            <Stat label={t("run.winRate")} value={<Percent value={s.winRate} />} />
            <Stat label={t("run.profitFactor")} value={s.profitFactor !== null ? s.profitFactor.toFixed(2) : "—"} />
            <Stat label={t("run.expectancy")} value={formatR(s.expectancyR)} tone={toneOf(s.expectancyR)} />
            <Stat
              label={t("run.maxDrawdown")}
              value={s.maxDrawdownAmount !== null ? formatMoney(-Math.abs(s.maxDrawdownAmount), run.currency) : "—"}
              hint={s.maxDrawdownPct !== null ? t("run.ofPeak", { pct: s.maxDrawdownPct.toFixed(1) }) : undefined}
              tone={s.maxDrawdownAmount ? "loss" : "neutral"}
            />
            <Stat
              label={t("run.trades")}
              value={String(s.tradeCount)}
              hint={t("run.winLossBe", {
                wins: String(s.wins),
                losses: String(s.losses),
                breakevens: String(s.breakevens),
              })}
            />
          </StatRow>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title={t("run.equityCurve")} />
        <PanelBody className="h-72">
          <EquityChart data={equityData} startBalance={Number(run.initialBalance)} currency={run.currency} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title={t("run.fillTitle")} caption={t("run.fillCaption")} />
        <PanelBody>
          <StatRow>
            <Stat label={t("run.initialBalance")} value={formatMoney(Number(run.initialBalance), run.currency)} />
            <Stat
              label={t("run.spread")}
              value={t("run.points", { value: String(run.fill.spreadPoints) })}
              hint={t("run.spreadHint")}
            />
            <Stat
              label={t("run.slippage")}
              value={t("run.points", { value: String(run.fill.slippagePoints) })}
              hint={t("run.slippageHint")}
            />
            <Stat
              label={t("run.commission")}
              value={formatMoney(Number(run.fill.commissionPerLot), run.currency)}
              hint={t("run.commissionHint")}
            />
            <Stat
              label={t("run.sameBar")}
              value={run.fill.pessimisticFills ? t("run.stopWins") : t("run.targetWins")}
              hint={run.fill.pessimisticFills ? t("run.honestDefault") : t("run.optimistic")}
            />
            <Stat label={t("run.barsProcessed")} value={s.barsProcessed.toLocaleString()} />
          </StatRow>
        </PanelBody>
      </Panel>

      {run.strategy ? (
        <Panel>
          <PanelHeader title={t("run.params")} caption={run.strategy.name} />
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
              <p className="text-xs text-ink-3">{t("common.noParams")}</p>
            )}
          </PanelBody>
        </Panel>
      ) : null}

      <Panel flush>
        <PanelHeader
          title={t("run.tradesTitle")}
          caption={t("run.tradesCaption", { count: String(run.trades.length) })}
        />
        <RunTradeTable trades={run.trades} currency={run.currency} />
      </Panel>
    </Page>
  );
}
