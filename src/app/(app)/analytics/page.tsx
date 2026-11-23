import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import {
  SectionHead,
  Panel,
  PanelHeader,
  PanelBody,
  TabsList,
  TabsTrigger,
  UrlTabs,
  TabsContent,
  Stat,
  StatRow,
  Label2,
} from "@/components/ui";
import { formatMoney, formatPercent, formatR } from "@/lib/metrics/formatters";
import { RangeControl } from "@/components/dashboard/range-control";
import { BreakdownTable } from "@/components/dashboard/breakdown-table";
import { InsightSentence } from "@/components/dashboard/insight-sentence";
import { ExtremesTable } from "@/components/dashboard/extremes-table";
import { RHistogram } from "@/components/charts/r-histogram";
import { SessionHeatmap } from "@/components/charts/session-heatmap";
import { HourOfDayChart } from "@/components/charts/hour-of-day-chart";
import { PeriodsView } from "@/components/dashboard/periods-view";
import { PnlRows } from "@/components/dashboard/pnl-rows";
import { DisciplinePanel } from "@/components/dashboard/discipline-panel";
import { EquityChart } from "@/components/charts/equity-chart";
import { DrawdownChart } from "@/components/charts/drawdown-chart";
import { requireUser, requireAccountAccess } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import {
  overview,
  breakdowns,
  rHistogram,
  heatmap,
  holdingBuckets,
  periods,
  resolveRange,
  isRangeKey,
  type RangeKey,
} from "@/lib/queries/analytics";

function toneOf(n: number | null): "profit" | "loss" | "neutral" {
  if (n === null || Math.abs(n) < 0.005) return "neutral";
  return n > 0 ? "profit" : "loss";
}

const TABS = ["breakdowns", "distribution", "timing", "periods", "equity"] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; tab?: string }>;
}) {
  const { range: rangeParam, tab: tabParam } = await searchParams;
  const tab = TABS.find((t) => t === tabParam) ?? "breakdowns";
  const user = await requireUser();

  const accountId = await resolveActiveAccountId(user.id);
  if (!accountId) redirect("/accounts");

  const account = await requireAccountAccess(accountId);
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "30d";
  const window = resolveRange(range, user.timezone);
  const ctx = { userId: user.id, accountId, from: window.from, to: window.to };

  // One round trip per view, but fetchAccountData() (analytics.ts) is
  // React-cached per (userId, accountId) for this request, so these five
  // calls share the underlying trade/account query instead of issuing it
  // five times.
  const [ov, bd, rh, hm, hb, pd] = await Promise.all([
    overview(ctx),
    breakdowns(ctx),
    rHistogram(ctx),
    heatmap(ctx),
    holdingBuckets(ctx),
    periods(ctx),
  ]);

  const t = await getTranslations("analytics");
  const tOv = await getTranslations("dashboard.overview");
  const currency = ov.currency;
  const s = ov.summary;

  return (
    <Page>
      <SectionHead title={t("title")} hint={account.label} actions={<RangeControl value={range} />} />

      <UrlTabs value={tab}>
        <TabsList>
          <TabsTrigger value="breakdowns">{t("tabs.breakdowns")}</TabsTrigger>
          <TabsTrigger value="distribution">{t("tabs.distribution")}</TabsTrigger>
          <TabsTrigger value="timing">{t("tabs.timing")}</TabsTrigger>
          <TabsTrigger value="periods">{t("tabs.periods")}</TabsTrigger>
          <TabsTrigger value="equity">{t("tabs.equity")}</TabsTrigger>
        </TabsList>

        <TabsContent value="breakdowns" className="flex flex-col gap-4 pt-4">
          <InsightSentence breakdowns={bd} currency={currency} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader title={t("breakdowns.symbol")} />
              <PanelBody padded={false}>
                <BreakdownTable rows={bd.symbol} currency={currency} keyLabel={t("breakdowns.symbol")} />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title={t("breakdowns.setupTag")} />
              <PanelBody padded={false}>
                <BreakdownTable rows={bd.tag} currency={currency} keyLabel={t("breakdowns.tag")} />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title={t("breakdowns.session")} />
              <PanelBody padded={false}>
                <BreakdownTable
                  rows={bd.marketSession}
                  labelNs="session"
                  currency={currency}
                  keyLabel={t("breakdowns.session")}
                />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title={t("breakdowns.direction")} />
              <PanelBody padded={false}>
                <BreakdownTable
                  rows={bd.direction}
                  labelNs="direction"
                  currency={currency}
                  keyLabel={t("breakdowns.direction")}
                />
              </PanelBody>
            </Panel>
            <Panel className="xl:col-span-2">
              <PanelHeader title={t("breakdowns.planFollowed")} />
              <PanelBody padded={false}>
                <BreakdownTable
                  rows={bd.followedPlan}
                  labelNs="plan"
                  currency={currency}
                  keyLabel={t("breakdowns.plan")}
                />
              </PanelBody>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="distribution" className="flex flex-col gap-4 pt-4">
          <StatRow>
            <Stat
              label={t("distribution.payoffRatio")}
              value={s.payoffRatio === null ? "—" : s.payoffRatio.toFixed(2)}
            />
            <Stat
              label={t("distribution.avgWin")}
              value={s.averageWin === null ? "—" : formatMoney(s.averageWin, currency)}
              tone="profit"
            />
            <Stat
              label={t("distribution.avgLoss")}
              value={s.averageLoss === null ? "—" : formatMoney(-s.averageLoss, currency)}
              tone="loss"
            />
            <Stat
              label={t("distribution.expectancy")}
              value={s.expectancyMoney === null ? "—" : formatMoney(s.expectancyMoney, currency)}
              tone={toneOf(s.expectancyMoney)}
            />
            <Stat label={t("distribution.expectancyR")} value={formatR(s.expectancyR)} tone={toneOf(s.expectancyR)} />
            <Stat
              label={t("distribution.systemQuality")}
              value={s.systemQuality === null ? "—" : s.systemQuality.toFixed(2)}
              hint={t("distribution.systemQualityHint")}
            />
          </StatRow>

          <Panel>
            <PanelHeader title={t("distribution.rDistribution")} caption={t("distribution.rDistributionCaption")} />
            <PanelBody className="h-64">
              <RHistogram buckets={rh.buckets} currency={currency} />
            </PanelBody>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <ExtremesTable title={t("distribution.biggestWinners")} trades={rh.topWinners} currency={currency} />
            </Panel>
            <Panel>
              <ExtremesTable title={t("distribution.biggestLosers")} trades={rh.topLosers} currency={currency} />
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="timing" className="flex flex-col gap-4 pt-4">
          <Panel>
            <PanelHeader title={t("timing.sessionHeatmap")} caption={t("timing.sessionHeatmapCaption")} />
            <PanelBody>
              <SessionHeatmap cells={hm} currency={currency} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title={t("timing.hourOfDay")} caption={t("timing.hourOfDayCaption")} />
            <PanelBody className="h-56">
              <HourOfDayChart rows={bd.hourOfDay} currency={currency} />
            </PanelBody>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader title={t("timing.weekday")} />
              <PanelBody padded={false}>
                <BreakdownTable
                  rows={bd.weekday}
                  labelNs="weekday"
                  currency={currency}
                  keyLabel={t("timing.weekday")}
                />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title={t("timing.holdingTime")} />
              <PanelBody padded={false}>
                <BreakdownTable rows={hb} currency={currency} keyLabel={t("timing.duration")} />
              </PanelBody>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="periods" className="flex flex-col gap-4 pt-4">
          <PeriodsView data={pd} currency={currency} />
        </TabsContent>

        {/* What the Overview showed before it became the day-by-day page:
            the activity-window summary (trades OPENED in the range, unlike
            the Overview's close-date cards), the per-trade equity curve with
            its drawdown, and the discipline figures. Labels are still the
            Overview's own, since these are the same panels moved. */}
        <TabsContent value="equity" className="flex flex-col gap-4 pt-4">
          <StatRow>
            <Stat
              label={tOv("netPnl")}
              size="lg"
              value={`${s.netPnl > 0.005 ? "+" : ""}${formatMoney(s.netPnl, currency)}`}
              tone={toneOf(s.netPnl)}
            />
            <Stat
              label={tOv("winRate")}
              value={formatPercent(s.winRate)}
              hint={
                s.breakevenWinRate !== null
                  ? tOv("breakevenHint", { pct: formatPercent(s.breakevenWinRate, 0) })
                  : tOv("notEnoughClosed")
              }
            />
            <Stat label={tOv("profitFactor")} value={s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)} />
            <Stat label={tOv("expectancyR")} value={formatR(s.expectancyR)} tone={toneOf(s.expectancyR)} />
            <Stat
              label={tOv("maxDrawdown")}
              value={ov.maxDrawdown ? formatPercent(ov.maxDrawdown.pct / 100) : "—"}
              hint={ov.maxDrawdown ? formatMoney(ov.maxDrawdown.amount, currency) : undefined}
              tone={ov.maxDrawdown && ov.maxDrawdown.amount > 0 ? "loss" : "neutral"}
            />
            <Stat
              label={tOv("currentStreak")}
              value={
                ov.streak.current === 0
                  ? "—"
                  : ov.streak.current > 0
                    ? tOv("streakWin", { count: ov.streak.current })
                    : tOv("streakLoss", { count: Math.abs(ov.streak.current) })
              }
              hint={tOv("longest", { win: ov.streak.longestWin, loss: ov.streak.longestLoss })}
              tone={ov.streak.current > 0 ? "profit" : ov.streak.current < 0 ? "loss" : "neutral"}
            />
          </StatRow>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Panel className="lg:col-span-8">
              <PanelHeader title={tOv("equity")} caption={currency} />
              <PanelBody className="h-56">
                <EquityChart
                  data={ov.equity}
                  startBalance={ov.equityStartBalance}
                  currency={currency}
                  showXAxis={false}
                />
              </PanelBody>
              <div className="border-t border-line px-3 pt-2 pb-1">
                <Label2>{tOv("drawdown")}</Label2>
              </div>
              <div className="h-24 px-1 pb-2">
                <DrawdownChart data={ov.drawdown} currency={currency} />
              </div>
            </Panel>

            <div className="flex flex-col gap-4 lg:col-span-4">
              <Panel>
                <PanelHeader title={tOv("pnl")} />
                <PanelBody padded={false}>
                  <PnlRows currency={currency} todayPnl={ov.todayPnl} weekPnl={ov.weekPnl} monthPnl={ov.monthPnl} />
                </PanelBody>
              </Panel>
              <Panel>
                <PanelHeader title={tOv("discipline")} />
                <PanelBody padded={false}>
                  <DisciplinePanel discipline={ov.discipline} />
                </PanelBody>
              </Panel>
            </div>
          </div>
        </TabsContent>
      </UrlTabs>
    </Page>
  );
}
