import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { cn } from "@/lib/cn";
import { SectionHead, Panel, PanelHeader, PanelBody, EmptyState, Button } from "@/components/ui";
import { RangeControl } from "@/components/dashboard/range-control";
import { RiskGuard } from "@/components/dashboard/risk-guard";
import { JournalNudge } from "@/components/dashboard/journal-nudge";
import { OpenPositionsPanel } from "@/components/dashboard/open-positions-panel";
import { RecentTradesTable } from "@/components/dashboard/recent-trades-table";
import { ChallengePanel } from "@/components/dashboard/challenge-panel";
import { CumulativePnlChart, DailyBalanceChart } from "@/components/charts/daily-balance-chart";
import { DailyPnlChart } from "@/components/charts/daily-pnl-chart";
import { CalendarGrid } from "@/components/journal/calendar-grid";
import { MonthNav } from "@/components/journal/month-nav";
import { isValidMonth, monthLabel, todayIn } from "@/components/journal/date-utils";
import { DurationBars } from "@/components/journal/stats/duration-bars";
import { JournalDetailCards, JournalHeadlineCards } from "@/components/journal/stats/journal-stats-grid";
import { requireUser, requireAccountAccess } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import { journalStats, overview } from "@/lib/queries/analytics";
import { monthView } from "@/lib/queries/journal";
import { resolveRangeDays } from "@/lib/range";

/**
 * The one page that answers "how am I doing": the figure cards, the daily
 * balance, the day-by-day and holding-time pictures, the month calendar and
 * the latest trades, top to bottom in the order a prop-firm dashboard lays
 * them out. It used to be a six-tile summary with the rest spread over
 * Analytics and the journal; the equity curve, drawdown, streaks and
 * discipline figures that were here are Analytics' Equity tab now.
 *
 * Everything range-scoped on it is `journalStats`: CLOSED trades, by close
 * date, over whole local days (`resolveRangeDays`) — the calendar's own
 * convention, so a card, a bar and a day cell always agree. The calendar
 * pages by `?month` on its own, and the challenge panel, open positions and
 * recent trades ignore the range on purpose: they are "right now".
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; month?: string }>;
}) {
  const t = await getTranslations("dashboard.overview");
  const tStats = await getTranslations("journal.stats");
  const params = await searchParams;
  const user = await requireUser();

  const accountId = await resolveActiveAccountId(user.id);
  if (!accountId) redirect("/accounts");

  // requireAccountAccess both re-validates ownership and gives us the row for
  // the account label in the header — see the SCOPING RULE in lib/session.ts.
  const account = await requireAccountAccess(accountId);

  const range = resolveRangeDays(params.range, user.timezone);
  const { date: today, month: currentMonth } = todayIn(user.timezone);
  const month = isValidMonth(params.month) ? params.month : currentMonth;
  const ctx = { userId: user.id, accountId, from: range.from, to: null };

  // overview() and journalStats() share one cached account load
  // (analytics/context.ts); monthView() reads its own month of trades.
  const [data, stats, view] = await Promise.all([
    overview(ctx),
    journalStats({ ...ctx, fromDate: range.fromDate }),
    monthView(user.id, accountId, month, user.timezone),
  ]);
  const firstRun = data.recentTrades.length === 0 && data.openTrades.length === 0;

  return (
    <Page>
      <SectionHead
        title={t("title")}
        hint={account.label}
        actions={<RangeControl value={range.key} keep={isValidMonth(params.month) ? { month } : undefined} />}
      />

      {/* Sits above the numbers on purpose: a rule breach today matters more
          than a 90-day statistic. */}
      <RiskGuard accountId={account.id} />
      <JournalNudge userId={user.id} timezone={user.timezone} />

      {data.prop || data.openTrades.length > 0 ? (
        // Side by side only when there are two of them; one alone takes the row.
        <div className={cn("grid grid-cols-1 gap-4", data.prop && data.openTrades.length > 0 && "lg:grid-cols-2")}>
          {data.prop ? <ChallengePanel prop={data.prop} currency={data.currency} /> : null}
          {/* Only when there is one: trades mostly arrive closed, from an
              import, and an always-empty panel is one more thing to read past. */}
          {data.openTrades.length > 0 ? (
            <Panel>
              <PanelHeader title={t("openPositions")} caption={String(data.openTrades.length)} />
              <PanelBody padded={false}>
                <OpenPositionsPanel trades={data.openTrades} currency={data.currency} />
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {firstRun ? (
        // First run: one clear next step, and nothing else. Twenty cards of
        // "No trades" and five empty charts under it taught nobody the layout.
        <Panel>
          <PanelBody>
            <EmptyState
              icon={<Sparkles className="size-4" />}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
            <div className="flex flex-wrap justify-center gap-2 pb-2">
              <Button asChild variant="primary">
                <Link href="/trades/import">{t("importStatement")}</Link>
              </Button>
              <Button asChild variant="default">
                <Link href="/trades/new">{t("logTrade")}</Link>
              </Button>
            </div>
          </PanelBody>
        </Panel>
      ) : (
        <>
          <JournalHeadlineCards stats={stats} />

          <Panel>
            <PanelHeader title={tStats("balance")} caption={tStats("balanceHelp")} />
            <PanelBody className="h-72">
              <DailyBalanceChart data={stats.balance} currency={stats.currency} />
            </PanelBody>
          </Panel>

          <JournalDetailCards stats={stats} timezone={user.timezone} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader title={tStats("cumulative")} caption={tStats("cumulativeHelp")} />
              <PanelBody className="h-72">
                <CumulativePnlChart data={stats.cumulative} currency={stats.currency} />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title={t("dailyPnl")} />
              <PanelBody className="h-72">
                <DailyPnlChart data={stats.daily} currency={stats.currency} />
              </PanelBody>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader title={tStats("durationCount")} caption={t("durationCaption")} />
              <PanelBody>
                <DurationBars rows={stats.durationBuckets} mode="count" />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title={tStats("durationWinRate")} caption={t("durationCaption")} />
              <PanelBody>
                <DurationBars rows={stats.durationBuckets} mode="winRate" />
              </PanelBody>
            </Panel>
          </div>

          <Panel>
            <PanelHeader
              title={monthLabel(month)}
              actions={<MonthNav month={month} currentMonth={currentMonth} keep={{ range: range.key }} basePath="/" />}
            />
            <CalendarGrid
              month={month}
              days={view.days}
              weeks={view.weeks}
              currency={stats.currency}
              today={today}
              // To the day's trades, not the journal's day page: the calendar
              // here is a way into the trades. A day with none has nowhere to go.
              dayHref={(day) => (day.tradeCount > 0 ? `/trades?day=${day.date}` : null)}
            />
          </Panel>

          <Panel>
            <PanelHeader
              title={t("recentTrades")}
              caption={t("last10")}
              actions={
                <Button asChild variant="link" size="sm">
                  <Link href="/trades">{t("allTrades")}</Link>
                </Button>
              }
            />
            <PanelBody padded={false}>
              <RecentTradesTable trades={data.recentTrades} currency={data.currency} timezone={user.timezone} />
            </PanelBody>
          </Panel>
        </>
      )}
    </Page>
  );
}
