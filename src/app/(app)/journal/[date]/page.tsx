import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Page } from "@/components/shell/page";
import { Panel, PanelHeader, PanelBody, SectionHead, Button, ButtonGroup } from "@/components/ui";
import { DayEditor } from "@/components/journal/day-editor";
import { DayTrades } from "@/components/journal/day-trades";
import { dayLabel, isValidDate, monthOf, shiftDay } from "@/components/journal/date-utils";
import { requireUser } from "@/lib/session";
import { dayView, resolveActiveTradingAccountId } from "@/lib/queries/journal";
import { getAccountCurrency } from "@/lib/queries/accounts";

export default async function JournalDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();

  const user = await requireUser();
  const accountId = await resolveActiveTradingAccountId(user.id);
  const currency = accountId ? ((await getAccountCurrency(accountId)) ?? "USD") : "USD";

  const view = await dayView(user.id, accountId, date, user.timezone);

  return (
    <Page>
      <SectionHead
        title={dayLabel(date)}
        hint={
          <Link href={`/journal?month=${monthOf(date)}`} className="text-brand hover:underline">
            ← Back to calendar
          </Link>
        }
        actions={
          <ButtonGroup>
            <Button asChild variant="default" size="sm" aria-label="Previous day">
              <Link href={`/journal/${shiftDay(date, -1)}`}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="default" size="sm" aria-label="Next day">
              <Link href={`/journal/${shiftDay(date, 1)}`}>
                <ChevronRight />
              </Link>
            </Button>
          </ButtonGroup>
        }
      />

      <Panel>
        <PanelHeader title="Plan & review" caption="Saves automatically when you click away from a field." />
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
          title="Trades"
          caption={`${view.trades.length} trade${view.trades.length === 1 ? "" : "s"}${accountId ? "" : " — no account selected"}`}
        />
        <PanelBody padded={false}>
          <DayTrades trades={view.trades} currency={currency} />
        </PanelBody>
      </Panel>
    </Page>
  );
}
