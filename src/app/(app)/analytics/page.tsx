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
} from "@/components/ui";
import { formatMoney, formatR } from "@/lib/metrics/formatters";
import { RangeControl } from "@/components/dashboard/range-control";
import { BreakdownTable } from "@/components/dashboard/breakdown-table";
import { InsightSentence } from "@/components/dashboard/insight-sentence";
import { ExtremesTable } from "@/components/dashboard/extremes-table";
import { RHistogram } from "@/components/charts/r-histogram";
import { SessionHeatmap } from "@/components/charts/session-heatmap";
import { HourOfDayChart } from "@/components/charts/hour-of-day-chart";
import { PeriodsView } from "@/components/dashboard/periods-view";
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

const TABS = ["breakdowns", "distribution", "timing", "periods"] as const;

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
      </UrlTabs>
    </Page>
  );
}
