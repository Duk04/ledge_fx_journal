import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { Panel, PanelHeader, PanelBody, SectionHead, Button } from "@/components/ui";
import { CalendarGrid } from "@/components/journal/calendar-grid";
import { MonthNav } from "@/components/journal/month-nav";
import { EntriesList } from "@/components/journal/entries-list";
import { RangeBar } from "@/components/journal/range-bar";
import { JournalStatsGrid } from "@/components/journal/stats/journal-stats-grid";
import { DailyBalanceChart } from "@/components/charts/daily-balance-chart";
import { isValidMonth, monthLabel, monthOf, todayIn } from "@/components/journal/date-utils";
import { requireUser } from "@/lib/session";
import { monthView, resolveActiveTradingAccountId } from "@/lib/queries/journal";
import { getAccountCurrency } from "@/lib/queries/accounts";
import { journalStats } from "@/lib/queries/analytics";
import { journalPresetDates, resolveJournalRange } from "@/lib/range";
import { dailyChecklist } from "@/lib/queries/checklist";
import { DailyChecklist } from "@/components/journal/daily-checklist";

/**
 * The journal: a range of figures and the account's daily balance on top,
 * the month calendar under them, then the written entries. The range
 * (`?from&to`) drives the figures and the chart; the calendar pages by
 * `?month`, defaulting to the month the range ends in. Both bucket closed
 * trades by close date, so a day cell and the figures above always agree
 * (lib/queries/analytics/journal-stats.ts).
 */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const { date: today, month: currentMonth } = todayIn(user.timezone);
  const range = resolveJournalRange(params, user.timezone);
  const month = isValidMonth(params.month) ? params.month : monthOf(range.to);

  const accountId = await resolveActiveTradingAccountId(user.id);
  const currency = accountId ? ((await getAccountCurrency(accountId)) ?? "USD") : "USD";

  const [view, stats, checklist] = await Promise.all([
    monthView(user.id, accountId, month, user.timezone),
    accountId
      ? journalStats({
          userId: user.id,
          accountId,
          from: range.window.from,
          to: range.window.to,
          fromDate: range.from,
        })
      : Promise.resolve(null),
    dailyChecklist(user.id, today),
  ]);
  const t = await getTranslations("journal.month");
  const tStats = await getTranslations("journal.stats");
  const keep = { from: range.from, to: range.to };

  return (
    <Page>
      <SectionHead title={t("title")} hint={accountId ? t("hint") : t("hintNoAccount")} />

      <DailyChecklist checklist={checklist} today />

      <RangeBar
        from={range.from}
        to={range.to}
        preset={range.preset}
        presets={journalPresetDates(user.timezone)}
        month={isValidMonth(params.month) ? params.month : undefined}
      />

      {stats ? (
        <>
          <JournalStatsGrid stats={stats} timezone={user.timezone} />

          <Panel>
            <PanelHeader title={tStats("balance")} caption={tStats("balanceHelp")} />
            <PanelBody className="h-72">
              <DailyBalanceChart data={stats.balance} currency={stats.currency} />
            </PanelBody>
          </Panel>
        </>
      ) : null}

      <Panel>
        <PanelHeader
          title={monthLabel(month)}
          caption={t("entriesCaption", { count: view.entries.length })}
          actions={<MonthNav month={month} currentMonth={currentMonth} keep={keep} />}
        />
        <CalendarGrid month={month} days={view.days} weeks={view.weeks} currency={currency} today={today} />
      </Panel>

      <Panel>
        <PanelHeader
          title={t("entries")}
          actions={
            !accountId ? (
              <Button asChild variant="link" size="sm">
                <Link href="/accounts">{t("addAccount")}</Link>
              </Button>
            ) : undefined
          }
        />
        <PanelBody padded={false}>
          <EntriesList entries={view.entries} />
        </PanelBody>
      </Panel>
    </Page>
  );
}
