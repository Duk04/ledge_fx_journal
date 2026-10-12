import Link from "next/link";
import { cn } from "@/lib/cn";
import { Money } from "@/components/ui";
import { formatMoneyCompact } from "@/lib/metrics/formatters";
import type { CalendarDay } from "@/lib/queries/journal";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Plain CSS grid, Monday-first. Each cell is a link to that day's journal
 * page — clicking any day, trades or not, always lands on a ready-to-fill
 * form (see docs/JOURNAL.md).
 */
export function CalendarGrid({
  month,
  days,
  currency,
  today,
}: {
  month: string; // "YYYY-MM"
  days: CalendarDay[];
  currency: string;
  /** Today's date ("YYYY-MM-DD") in the user's timezone, for the "today" ring. */
  today: string;
}) {
  const [year, monthNum] = month.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const leadingCount = firstWeekday;
  const totalCells = leadingCount + days.length;
  const trailingCount = (7 - (totalCells % 7)) % 7;

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="label px-2 py-2 text-center">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: leadingCount }).map((_, i) => (
          <div key={`lead-${i}`} className="min-h-[5.5rem] border-r border-b border-line-faint bg-panel-sunken" />
        ))}
        {days.map((day) => (
          <DayCell key={day.date} day={day} currency={currency} isToday={day.date === today} />
        ))}
        {Array.from({ length: trailingCount }).map((_, i) => (
          <div key={`trail-${i}`} className="min-h-[5.5rem] border-r border-b border-line-faint bg-panel-sunken" />
        ))}
      </div>
    </div>
  );
}

function DayCell({ day, currency, isToday }: { day: CalendarDay; currency: string; isToday: boolean }) {
  const dayNum = Number(day.date.slice(-2));
  const hasTrades = day.tradeCount > 0;
  const netPnl = day.netPnl !== null ? Number(day.netPnl) : null;

  return (
    <Link
      href={`/journal/${day.date}`}
      className={cn(
        "group relative flex min-h-[5.5rem] flex-col gap-1 border-r border-b border-line-faint p-1.5",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover",
        // Days with an entry but no trades get their own quiet highlight —
        // that distinction (entry-only vs. nothing at all) is the point of
        // this whole view.
        !hasTrades && day.hasEntry && "bg-brand-weak",
        !hasTrades && !day.hasEntry && "bg-panel-sunken",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "mono text-2xs",
            isToday
              ? "flex size-4 items-center justify-center rounded-full bg-brand font-medium text-brand-ink"
              : "text-ink-3",
          )}
        >
          {dayNum}
        </span>
        {day.hasEntry ? (
          <span
            aria-label="Has a journal entry"
            title="Has a journal entry"
            className="size-1.5 shrink-0 rounded-full bg-brand"
          />
        ) : null}
      </div>

      {hasTrades ? (
        <div className="mt-auto flex flex-col gap-0.5">
          {/* A day cell is ~50px wide on a phone: a full "+$1,234.56"
              overflowed it. The compact form is shown there, the exact
              figure from sm up. */}
          <span
            className={cn(
              "mono text-xs font-medium sm:hidden",
              (netPnl ?? 0) > 0.005 ? "val-pos" : (netPnl ?? 0) < -0.005 ? "val-neg" : "val-flat",
            )}
          >
            {formatMoneyCompact(netPnl, currency)}
          </span>
          <Money value={netPnl} currency={currency} signed className="hidden text-xs font-medium sm:inline" />
          <span className="text-2xs text-ink-3">
            {day.tradeCount} trade{day.tradeCount === 1 ? "" : "s"}
          </span>
        </div>
      ) : day.hasEntry ? (
        <span className="mt-auto text-2xs font-medium text-brand">Entry, no trades</span>
      ) : null}
    </Link>
  );
}
