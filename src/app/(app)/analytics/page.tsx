import { redirect } from "next/navigation";
import { Page } from "@/components/shell/page";
import {
  SectionHead,
  Panel,
  PanelHeader,
  PanelBody,
  Tabs,
  TabsList,
  TabsTrigger,
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
import { requireUser, requireAccountAccess } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import {
  overview,
  breakdowns,
  rHistogram,
  heatmap,
  holdingBuckets,
  resolveRange,
  isRangeKey,
  type RangeKey,
} from "@/lib/queries/analytics";

function toneOf(n: number | null): "profit" | "loss" | "neutral" {
  if (n === null || Math.abs(n) < 0.005) return "neutral";
  return n > 0 ? "profit" : "loss";
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
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
  const [ov, bd, rh, hm, hb] = await Promise.all([
    overview(ctx),
    breakdowns(ctx),
    rHistogram(ctx),
    heatmap(ctx),
    holdingBuckets(ctx),
  ]);

  const currency = ov.currency;
  const s = ov.summary;

  return (
    <Page>
      <SectionHead title="Analytics" hint={account.label} actions={<RangeControl value={range} />} />

      <Tabs defaultValue="breakdowns">
        <TabsList>
          <TabsTrigger value="breakdowns">Breakdowns</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="timing">Timing</TabsTrigger>
        </TabsList>

        <TabsContent value="breakdowns" className="flex flex-col gap-4 pt-4">
          <InsightSentence breakdowns={bd} currency={currency} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader title="Symbol" />
              <PanelBody padded={false}>
                <BreakdownTable rows={bd.symbol} currency={currency} keyLabel="Symbol" />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Setup tag" />
              <PanelBody padded={false}>
                <BreakdownTable rows={bd.tag} currency={currency} keyLabel="Tag" />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Session" />
              <PanelBody padded={false}>
                <BreakdownTable rows={bd.marketSession} currency={currency} keyLabel="Session" />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Direction" />
              <PanelBody padded={false}>
                <BreakdownTable rows={bd.direction} currency={currency} keyLabel="Direction" />
              </PanelBody>
            </Panel>
            <Panel className="xl:col-span-2">
              <PanelHeader title="Plan followed" />
              <PanelBody padded={false}>
                <BreakdownTable rows={bd.followedPlan} currency={currency} keyLabel="Plan" />
              </PanelBody>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="distribution" className="flex flex-col gap-4 pt-4">
          <StatRow>
            <Stat label="Payoff ratio" value={s.payoffRatio === null ? "—" : s.payoffRatio.toFixed(2)} />
            <Stat
              label="Avg win"
              value={s.averageWin === null ? "—" : formatMoney(s.averageWin, currency)}
              tone="profit"
            />
            <Stat
              label="Avg loss"
              value={s.averageLoss === null ? "—" : formatMoney(-s.averageLoss, currency)}
              tone="loss"
            />
            <Stat
              label="Expectancy"
              value={s.expectancyMoney === null ? "—" : formatMoney(s.expectancyMoney, currency)}
              tone={toneOf(s.expectancyMoney)}
            />
            <Stat label="Expectancy R" value={formatR(s.expectancyR)} tone={toneOf(s.expectancyR)} />
            <Stat
              label="System quality"
              value={s.systemQuality === null ? "—" : s.systemQuality.toFixed(2)}
              hint="meaningful at 30+ trades"
            />
          </StatRow>

          <Panel>
            <PanelHeader title="R distribution" caption="frequency by R multiple" />
            <PanelBody className="h-64">
              <RHistogram buckets={rh.buckets} currency={currency} />
            </PanelBody>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <ExtremesTable title="Biggest winners" trades={rh.topWinners} currency={currency} />
            </Panel>
            <Panel>
              <ExtremesTable title="Biggest losers" trades={rh.topLosers} currency={currency} />
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="timing" className="flex flex-col gap-4 pt-4">
          <Panel>
            <PanelHeader title="Session heatmap" caption="weekday x session, net P&L" />
            <PanelBody>
              <SessionHeatmap cells={hm} currency={currency} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Hour of day" caption="net P&L, local time" />
            <PanelBody className="h-56">
              <HourOfDayChart rows={bd.hourOfDay} currency={currency} />
            </PanelBody>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader title="Weekday" />
              <PanelBody padded={false}>
                <BreakdownTable rows={bd.weekday} currency={currency} keyLabel="Weekday" />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Holding time" />
              <PanelBody padded={false}>
                <BreakdownTable rows={hb} currency={currency} keyLabel="Duration" />
              </PanelBody>
            </Panel>
          </div>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
