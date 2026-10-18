import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Page } from "@/components/shell/page";
import { Panel, PanelHeader, PanelBody, SectionHead, Button, ButtonGroup } from "@/components/ui";
import { DayEditor } from "@/components/journal/day-editor";
import { DayTrades } from "@/components/journal/day-trades";
import { dayLabel, isValidDate, monthOf, shiftDay } from "@/components/journal/date-utils";
import { requireUser } from "@/lib/session";
import { dayView, resolveActiveTradingAccountId } from "@/lib/queries/journal";
import { getAccountCurrency } from "@/lib/queries/accounts";
import { dailyChecklist } from "@/lib/queries/checklist";
import { DailyChecklist } from "@/components/journal/daily-checklist";

export default async function JournalDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();

  const user = await requireUser();
  const accountId = await resolveActiveTradingAccountId(user.id);
  const currency = accountId ? ((await getAccountCurrency(accountId)) ?? "USD") : "USD";

  const [view, checklist] = await Promise.all([
    dayView(user.id, accountId, date, user.timezone),
    dailyChecklist(user.id, date),
  ]);
  const t = await getTranslations("journal.day");

  return (
    <Page>
      <SectionHead
        title={dayLabel(date)}
        hint={
          <Link href={`/journal?month=${monthOf(date)}`} className="text-brand hover:underline">
            {t("back")}
          </Link>
        }
        actions={
          <ButtonGroup>
            <Button asChild variant="default" size="sm" aria-label={t("previousDay")}>
              <Link href={`/journal/${shiftDay(date, -1)}`}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="default" size="sm" aria-label={t("nextDay")}>
              <Link href={`/journal/${shiftDay(date, 1)}`}>
                <ChevronRight />
              </Link>
            </Button>
          </ButtonGroup>
        }
      />

      {/* First on the page: it is what you go through before the plan. */}
      <DailyChecklist checklist={checklist} />

      <Panel>
        <PanelHeader title={t("planTitle")} caption={t("planCaption")} />
        <PanelBody>
          <DayEditor
            date={date}
            preMarket={view.entry?.preMarket ?? ""}
            review={view.entry?.review ?? ""}
            updatedAt={view.entry?.updatedAt ?? null}
            mood={view.entry?.mood ?? null}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title={t("trades")}
          caption={t(accountId ? "tradesCaption" : "tradesCaptionNoAccount", { count: view.trades.length })}
        />
        <PanelBody padded={false}>
          <DayTrades trades={view.trades} currency={currency} />
        </PanelBody>
      </Panel>
    </Page>
  );
}
