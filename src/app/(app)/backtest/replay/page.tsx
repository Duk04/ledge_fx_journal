import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { SectionHead, EmptyState, Panel, PanelBody } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { getInstrument } from "@/lib/queries/instruments";
import { getRun } from "@/lib/queries/backtests";
import { listCoverage, getBars } from "@/lib/queries/candles";
import { resolveConversion } from "@/lib/conversion";
import { ReplaySetupForm } from "@/components/backtest/replay/replay-setup-form";
import { ReplaySession } from "@/components/backtest/replay/replay-session";

export default async function ReplayPage({ searchParams }: { searchParams: Promise<{ runId?: string }> }) {
  const { runId } = await searchParams;
  const user = await requireUser();
  const t = await getTranslations("backtest.replay");

  if (!runId) {
    const coverage = await listCoverage(user.id);
    return (
      <Page>
        <SectionHead title={t("title")} hint={t("hint")} />
        {coverage.length === 0 ? (
          <Panel>
            <PanelBody>
              <EmptyState title={t("noDataTitle")} description={t("noDataDescription")} />
            </PanelBody>
          </Panel>
        ) : (
          <ReplaySetupForm coverage={coverage} />
        )}
      </Page>
    );
  }

  const run = await getRun(user.id, runId);
  if (!run || run.kind !== "REPLAY") notFound();

  const instrument = await getInstrument(run.symbol);
  if (!instrument) notFound();

  const { bars } = await getBars({
    symbol: run.symbol,
    timeframe: run.timeframe,
    from: new Date(run.fromTs),
    to: new Date(run.toTs),
  });

  if (bars.length === 0) {
    return (
      <Page>
        <SectionHead title={run.label ?? run.symbol} />
        <Panel>
          <PanelBody>
            <EmptyState title={t("noBarsTitle")} description={t("noBarsDescription")} />
          </PanelBody>
        </Panel>
      </Page>
    );
  }

  // Same fixed-rate approach `runStrategy` uses (see actions/backtests.ts):
  // one conversion rate for the whole session, from the last bar's close —
  // there is nowhere to store a per-trade rate on a BacktestRun.
  const conversionRate = resolveConversion({
    instrument,
    accountCurrency: run.currency,
    referencePrice: bars[bars.length - 1].close,
  }).rate.toNumber();

  return (
    <Page>
      <SectionHead
        title={run.label ?? run.symbol}
        hint={t("sessionHint", { symbol: run.symbol, timeframe: run.timeframe })}
      />
      <ReplaySession
        runId={run.id}
        symbol={run.symbol}
        bars={bars}
        instrument={{
          symbol: instrument.symbol,
          digits: instrument.digits,
          pipSize: Number(instrument.pipSize),
          contractSize: Number(instrument.contractSize),
          quoteCurrency: instrument.quoteCurrency,
          pointSize: 10 ** -instrument.digits,
        }}
        fill={{
          spreadPoints: run.fill.spreadPoints,
          commissionPerLot: Number(run.fill.commissionPerLot),
          slippagePoints: run.fill.slippagePoints,
          pessimisticFills: run.fill.pessimisticFills,
          conversionRate,
        }}
        initialBalance={Number(run.initialBalance)}
        currency={run.currency}
      />
    </Page>
  );
}
