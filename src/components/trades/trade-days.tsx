import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DirectionBadge, EmptyState, Money, Panel, PanelBody, PanelHeader, RValue } from "@/components/ui";
import { dayLabel } from "@/components/journal/date-utils";
import { formatInZone } from "@/lib/metrics/formatters";
import type { TradeDayGroup } from "@/lib/queries/trades";
import { ShotCell, ShotGallery, ShotPlaceholder } from "./trade-shots";

/**
 * The trade list as days: one panel per day, newest first, with the day's
 * result in its header and each of its trades as a card that leads with the
 * chart screenshot. The table answers "which trades"; this answers "what did
 * that day look like".
 *
 * A server component. The pictures and the screenshot buttons are client
 * components that reach the page's one screenshot dialog, so this must render
 * inside a `TradeShotsProvider` (trade-shots.tsx), like the table.
 */
export async function TradeDays({
  days,
  currency,
  timezone,
}: {
  days: TradeDayGroup[];
  currency: string;
  timezone: string;
}) {
  const t = await getTranslations("trades");
  if (days.length === 0) {
    // A page past the last day, or filters that match only cancelled orders
    // (which belong to no day).
    return (
      <Panel>
        <PanelBody>
          <EmptyState title={t("list.noRowsOnPage")} />
        </PanelBody>
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => (
        <Panel key={day.date}>
          <PanelHeader
            title={dayLabel(day.date)}
            caption={t("days.summary", { count: day.trades.length, wins: day.wins, losses: day.losses })}
            actions={<Money value={day.netPnl} currency={currency} signed className="text-sm font-semibold" />}
          />
          <PanelBody className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {day.trades.map((trade) => (
              <article key={trade.id} className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/trades/${trade.id}`}
                    className="flex min-w-0 items-center gap-2 rounded-control hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {/* The time that put it on this day: its close, or its
                        open while it is still open. */}
                    <span className="mono shrink-0 text-xs text-ink-3">
                      {formatInZone(trade.closedAt ?? trade.openedAt, timezone, "HH:mm")}
                    </span>
                    <span className="truncate text-sm font-medium text-ink">{trade.symbol}</span>
                    <DirectionBadge direction={trade.direction} />
                  </Link>
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    <RValue value={trade.rMultiple} className="text-xs" />
                    <Money value={trade.netPnl} currency={currency} signed />
                    <ShotCell tradeId={trade.id} count={trade.attachments.length} />
                  </div>
                </div>

                {trade.attachments.length > 0 ? (
                  <ShotGallery attachments={trade.attachments} />
                ) : (
                  <ShotPlaceholder tradeId={trade.id} />
                )}

                {trade.notes ? (
                  <p className="line-clamp-3 text-sm whitespace-pre-wrap text-ink-2">{trade.notes}</p>
                ) : null}
              </article>
            ))}
          </PanelBody>
        </Panel>
      ))}
    </div>
  );
}
