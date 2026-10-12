import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { Panel, PanelHeader, PanelBody, SectionHead, Button } from "@/components/ui";
import { CalendarGrid } from "@/components/journal/calendar-grid";
import { MonthNav } from "@/components/journal/month-nav";
import { EntriesList } from "@/components/journal/entries-list";
import { isValidMonth, monthLabel, todayIn } from "@/components/journal/date-utils";
import { requireUser } from "@/lib/session";
import { monthView, resolveActiveTradingAccountId } from "@/lib/queries/journal";
import { getAccountCurrency } from "@/lib/queries/accounts";

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const params = await searchParams;
  const user = await requireUser();
  const { date: today, month: currentMonth } = todayIn(user.timezone);
  const month = isValidMonth(params.month) ? params.month : currentMonth;

  const accountId = await resolveActiveTradingAccountId(user.id);
  const currency = accountId ? ((await getAccountCurrency(accountId)) ?? "USD") : "USD";

  const view = await monthView(user.id, accountId, month, user.timezone);
  const t = await getTranslations("journal.month");

  return (
    <Page>
      <SectionHead
        title={t("title")}
        hint={accountId ? t("hint") : t("hintNoAccount")}
        actions={<MonthNav month={month} currentMonth={currentMonth} />}
      />

      <Panel>
        <PanelHeader title={monthLabel(month)} caption={t("entriesCaption", { count: view.entries.length })} />
        <CalendarGrid month={month} days={view.days} currency={currency} today={today} />
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
