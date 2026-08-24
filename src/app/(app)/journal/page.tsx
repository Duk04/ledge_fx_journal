import Link from "next/link";
import { Page } from "@/components/shell/page";
import { Panel, PanelHeader, PanelBody, SectionHead, Button } from "@/components/ui";
import { CalendarGrid } from "@/components/journal/calendar-grid";
import { MonthNav } from "@/components/journal/month-nav";
import { EntriesList } from "@/components/journal/entries-list";
import { isValidMonth, monthLabel, todayIn } from "@/components/journal/date-utils";
import { requireUser } from "@/lib/session";
import { monthView, resolveActiveTradingAccountId } from "@/lib/queries/journal";
import { prisma } from "@/lib/db";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const { date: today, month: currentMonth } = todayIn(user.timezone);
  const month = isValidMonth(params.month) ? params.month : currentMonth;

  const accountId = await resolveActiveTradingAccountId(user.id);
  const currency = accountId
    ? ((await prisma.tradingAccount.findUnique({ where: { id: accountId }, select: { currency: true } }))
        ?.currency ?? "USD")
    : "USD";

  const view = await monthView(user.id, accountId, month, user.timezone);

  return (
    <Page>
      <SectionHead
        title="Journal"
        hint={
          accountId
            ? "The discipline half of the ledger — what you planned, what you did, and how it went."
            : "No trading account yet — trades won't show on the calendar until you add one."
        }
        actions={<MonthNav month={month} currentMonth={currentMonth} />}
      />

      <Panel>
        <PanelHeader title={monthLabel(month)} caption={`${view.entries.length} entr${view.entries.length === 1 ? "y" : "ies"} this month`} />
        <CalendarGrid month={month} days={view.days} currency={currency} today={today} />
      </Panel>

      <Panel>
        <PanelHeader
          title="Entries"
          actions={
            !accountId ? (
              <Button asChild variant="link" size="sm">
                <Link href="/accounts">Add a trading account</Link>
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
