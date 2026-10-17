import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { Money } from "@/components/ui";
import { formatMoneyCompact } from "@/lib/metrics/formatters";
import type { CalendarDay, CalendarWeek } from "@/lib/queries/journal";

const WEEKDAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

/**
 * Plain CSS grid, Monday-first, with a weekly total at the end of each row.
 * Each day cell is a link to that day's journal page — clicking any day,
 * trades or not, always lands on a ready-to-fill form (see docs/JOURNAL.md).
 *
 * A day with closed trades is tinted by its result, so a month reads as a
 * pattern of green and red before a single number is read. The weekly cell
 * sits in an eighth column from md up; on a phone there is no room for it,
 * so it becomes a full-width strip under its week instead.
 */
export async function CalendarGrid({
  month,
  days,
  weeks,
  currency,
  today,
}: {
  month: string; // "YYYY-MM"
  days: CalendarDay[];
  weeks: CalendarWeek[];
  currency: string;
  /** Today's date ("YYYY-MM-DD") in the user's timezone, for the "today" ring. */
  today: string;
}) {
  const tWeekday = await getTranslations("enums.weekdayShort");
  const t = await getTranslations("journal.calendar");
  const [year, monthNum] = month.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay() + 6) % 7; // Mon=0..Sun=6

  // Pad to whole weeks, then cut into rows.
  const cells: (CalendarDay | null)[] = [...Array<null>(firstWeekday).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line md:grid-cols-8">
        {WEEKDAY_KEYS.map((w) => (
          <div key={w} className="label px-2 py-2 text-center">
            {tWeekday(w)}
          </div>
        ))}
        <div className="label hidden px-2 py-2 text-center md:block" aria-hidden />
      </div>
      <div className="grid grid-cols-7 md:grid-cols-8">
        {rows.map((row, r) => (
          <WeekRow
            key={r}
            row={row}
            week={weeks.find((w) => w.index === r + 1)}
            index={r + 1}
            currency={currency}
            today={today}
            weekLabel={t("week", { n: r + 1 })}
            tradeCountLabel={(count) => t("tradeCount", { count })}
          />
        ))}
      </div>
    </div>
  );
}

function WeekRow({
  row,
  week,
  index,
  currency,
  today,
  weekLabel,
  tradeCountLabel,
}: {
  row: (CalendarDay | null)[];
  week: CalendarWeek | undefined;
  index: number;
  currency: string;
  today: string;
  weekLabel: string;
  tradeCountLabel: (count: number) => string;
}) {
  const net = week ? Number(week.netPnl) : 0;
  return (
    <>
      {row.map((day, i) =>
        day ? (
          <DayCell key={day.date} day={day} currency={currency} isToday={day.date === today} />
        ) : (
          <div
            key={`pad-${index}-${i}`}
            className="min-h-[5.5rem] border-r border-b border-line-faint bg-panel-sunken"
          />
        ),
      )}
      <div
        className={cn(
          "col-span-7 flex items-center justify-between gap-2 border-b border-line-faint bg-panel-sunken px-2 py-1.5",
          "md:col-span-1 md:min-h-[5.5rem] md:flex-col md:items-center md:justify-center md:gap-0.5 md:py-1.5",
        )}
      >
        <span className="text-2xs font-medium text-ink-2">{weekLabel}</span>
        <Money value={net} currency={currency} signed className="text-sm font-semibold" />
        <span className="text-2xs text-ink-3">{tradeCountLabel(week?.tradeCount ?? 0)}</span>
      </div>
    </>
  );
}

async function DayCell({ day, currency, isToday }: { day: CalendarDay; currency: string; isToday: boolean }) {
  const t = await getTranslations("journal.calendar");
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
        // Tinted by the day's result; a day of only open trades stays plain.
        hasTrades && (netPnl ?? 0) > 0.005 && "bg-profit-weak",
        hasTrades && (netPnl ?? 0) < -0.005 && "bg-loss-weak",
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
          <span aria-label={t("hasEntry")} title={t("hasEntry")} className="size-1.5 shrink-0 rounded-full bg-brand" />
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
          <Money value={netPnl} currency={currency} signed className="hidden text-sm font-semibold sm:inline" />
          <span className="text-2xs text-ink-3">{t("tradeCount", { count: day.tradeCount })}</span>
        </div>
      ) : day.hasEntry ? (
        <span className="mt-auto text-2xs font-medium text-brand">{t("entryNoTrades")}</span>
      ) : null}
    </Link>
  );
}
