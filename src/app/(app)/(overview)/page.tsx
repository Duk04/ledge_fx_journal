import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Page, Grid } from "@/components/shell/page";
import { SectionHead, Panel, PanelHeader, PanelBody, Label2, StatRow, Stat, EmptyState, Button } from "@/components/ui";
import { formatMoney, formatPercent, formatR } from "@/lib/metrics/formatters";
import { RangeControl } from "@/components/dashboard/range-control";
import { RiskGuard } from "@/components/dashboard/risk-guard";
import { OpenPositionsPanel } from "@/components/dashboard/open-positions-panel";
import { PnlRows } from "@/components/dashboard/pnl-rows";
import { DisciplinePanel } from "@/components/dashboard/discipline-panel";
import { RecentTradesTable } from "@/components/dashboard/recent-trades-table";
import { ChallengePanel } from "@/components/dashboard/challenge-panel";
import { EquityChart } from "@/components/charts/equity-chart";
import { DrawdownChart } from "@/components/charts/drawdown-chart";
import { DailyPnlChart } from "@/components/charts/daily-pnl-chart";
import { requireUser, requireAccountAccess } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import { overview, resolveRange, isRangeKey, type RangeKey } from "@/lib/queries/analytics";

/** Sign-aware tone for the numbers that flip between profit/loss/neutral. */
function toneOf(n: number | null): "profit" | "loss" | "neutral" {
  if (n === null || Math.abs(n) < 0.005) return "neutral";
  return n > 0 ? "profit" : "loss";
}

function streakLabel(current: number): string {
  if (current === 0) return "—";
  return current > 0 ? `${current}W` : `${Math.abs(current)}L`;
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: rangeParam } = await searchParams;
  const user = await requireUser();

  const accountId = await resolveActiveAccountId(user.id);
  if (!accountId) redirect("/accounts");

  // requireAccountAccess both re-validates ownership and gives us the row for
  // the account label in the header — see the SCOPING RULE in lib/session.ts.
  const account = await requireAccountAccess(accountId);

  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "30d";
  const window = resolveRange(range, user.timezone);
  const data = await overview({ userId: user.id, accountId, from: window.from, to: window.to });
  const s = data.summary;

  return (
    <Page>
      <SectionHead title="Overview" hint={account.label} actions={<RangeControl value={range} />} />

      {/* Sits above the numbers on purpose: a rule breach today matters more
          than a 90-day statistic. */}
      <RiskGuard accountId={account.id} />

      <StatRow>
        {/* The headline: larger, and signed (colour is never the only cue).
            No sparkline here: at six tiles across it spilled into the next
            tile, and the equity chart directly below already draws it. */}
        <Stat
          label="Net P&L"
          size="lg"
          value={`${s.netPnl > 0.005 ? "+" : ""}${formatMoney(s.netPnl, data.currency)}`}
          tone={toneOf(s.netPnl)}
        />
        <Stat
          label="Win rate"
          value={formatPercent(s.winRate)}
          hint={
            s.breakevenWinRate !== null
              ? `needs ${formatPercent(s.breakevenWinRate, 0)} to break even`
              : "not enough closed trades"
          }
        />
        <Stat label="Profit factor" value={s.profitFactor === null ? "—" : s.profitFactor.toFixed(2)} />
        <Stat label="Expectancy R" value={formatR(s.expectancyR)} tone={toneOf(s.expectancyR)} />
        <Stat
          label="Max drawdown"
          value={data.maxDrawdown ? formatPercent(data.maxDrawdown.pct / 100) : "—"}
          hint={data.maxDrawdown ? formatMoney(data.maxDrawdown.amount, data.currency) : undefined}
          tone={data.maxDrawdown && data.maxDrawdown.amount > 0 ? "loss" : "neutral"}
        />
        <Stat
          label="Current streak"
          value={streakLabel(data.streak.current)}
          hint={`longest: ${data.streak.longestWin}w / ${data.streak.longestLoss}l`}
          tone={data.streak.current > 0 ? "profit" : data.streak.current < 0 ? "loss" : "neutral"}
        />
      </StatRow>

      {data.recentTrades.length === 0 && data.openTrades.length === 0 ? (
        // First run: one clear next step instead of six dashes and three empty
        // charts. The panels below still render, so the layout a user is about
        // to fill is visible.
        <Panel>
          <PanelBody>
            <EmptyState
              icon={<Sparkles className="size-4" />}
              title="Nothing logged on this account yet"
              description="Log your first trade by hand, or import a MetaTrader statement to bring in your history at once."
            />
            <div className="flex flex-wrap justify-center gap-2 pb-2">
              <Button asChild variant="primary">
                <Link href="/trades/new">Log a trade</Link>
              </Button>
              <Button asChild variant="default">
                <Link href="/trades/import">Import a statement</Link>
              </Button>
            </div>
          </PanelBody>
        </Panel>
      ) : null}

      <Grid>
        <Panel className="lg:col-span-8">
          <PanelHeader title="Equity" caption={data.currency} />
          <PanelBody className="h-56">
            <EquityChart
              data={data.equity}
              startBalance={data.equityStartBalance}
              currency={data.currency}
              showXAxis={false}
            />
          </PanelBody>
          <div className="border-t border-line px-3 pt-2 pb-1">
            <Label2>Drawdown</Label2>
          </div>
          <div className="h-24 px-1 pb-2">
            <DrawdownChart data={data.drawdown} currency={data.currency} />
          </div>
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-4">
          {data.prop ? <ChallengePanel prop={data.prop} currency={data.currency} /> : null}

          <Panel>
            <PanelHeader title="Open positions" caption={String(data.openTrades.length)} />
            <PanelBody padded={false}>
              <OpenPositionsPanel trades={data.openTrades} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="P&L" />
            <PanelBody padded={false}>
              <PnlRows
                currency={data.currency}
                todayPnl={data.todayPnl}
                weekPnl={data.weekPnl}
                monthPnl={data.monthPnl}
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Discipline" />
            <PanelBody padded={false}>
              <DisciplinePanel discipline={data.discipline} />
            </PanelBody>
          </Panel>
        </div>

        <Panel className="lg:col-span-7">
          <PanelHeader title="Recent trades" caption="Last 10" />
          <PanelBody padded={false}>
            <RecentTradesTable trades={data.recentTrades} currency={data.currency} timezone={user.timezone} />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-5">
          <PanelHeader title="Daily P&L" />
          <PanelBody className="h-64">
            <DailyPnlChart data={data.dailyPnl} currency={data.currency} />
          </PanelBody>
        </Panel>
      </Grid>
    </Page>
  );
}
