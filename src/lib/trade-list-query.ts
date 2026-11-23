import { TZDate } from "@date-fns/tz";
import type { Direction } from "@prisma/client";
import { isJournalDate } from "@/lib/journal-date";
import { isRangeKey, resolveRange } from "@/lib/range";
import type { TradeFilters, TradeOutcomeFilter } from "@/lib/queries/trades";

/**
 * The trade list's URL -> its filters and paging. Pure, so it is tested
 * without a page; the page used to do this inline, and two things went wrong
 * there:
 *
 *  - Dates resolved in the SERVER's timezone. "YTD" was the server's New
 *    Year, and a custom "from 2026-03-05" was midnight UTC — so for a user in
 *    UTC+8 the list dropped trades opened between 00:00 and 08:00 local time
 *    while printing every date in their own zone. Ranges here go through the
 *    same `resolveRange` as Overview and Analytics, and custom days are the
 *    user's days.
 *  - Values were cast, not checked. `?directions=FOO` reached Prisma as an
 *    enum it rejects and `?from=2026-13-01` as an Invalid Date; a stale or
 *    hand-edited link landed on the error page. An unknown value is now
 *    dropped, as if that filter were not set.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZES = [25, 50, 100];

/** `TradeImport.id` is a uuid; anything else in `?import=` is dropped rather
 * than handed to Postgres to reject. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DIRECTIONS: readonly Direction[] = ["LONG", "SHORT"];
const OUTCOMES: readonly TradeOutcomeFilter[] = ["WIN", "LOSS", "BREAKEVEN", "OPEN"];

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function csv(v: string | string[] | undefined): string[] {
  const s = first(v);
  return s ? s.split(",").filter(Boolean) : [];
}

export interface TradeListQuery {
  filters: TradeFilters;
  /** Whether anything narrows the list — "no trades yet" vs "none match". */
  filtersActive: boolean;
  page: number;
  pageSize: number;
}

export function parseTradeListQuery(sp: SearchParams, timezone: string, now: Date = new Date()): TradeListQuery {
  const q = first(sp.q)?.trim() || undefined;
  const symbols = csv(sp.symbols);
  const directions = csv(sp.directions).filter((d): d is Direction => (DIRECTIONS as readonly string[]).includes(d));
  const outcomeParam = first(sp.outcome);
  const outcome = OUTCOMES.find((o) => o === outcomeParam);
  const tagIds = csv(sp.tags);
  const followed = first(sp.followedPlan);
  const followedPlan = followed === "yes" ? true : followed === "no" ? false : undefined;
  // Three filters that arrive by link rather than from the bar's own
  // controls: the trades of one import (after importing), one calendar day
  // (from the Overview's calendar), and "no screenshot yet".
  const importParam = first(sp.import);
  const importId = importParam && UUID.test(importParam) ? importParam : undefined;
  const withoutScreenshot = first(sp.shots) === "none";
  const dayParam = first(sp.day);
  const day = isJournalDate(dayParam) ? dayWindow(dayParam, timezone) : undefined;

  const rangeParam = first(sp.range);
  const range = rangeParam === "custom" || isRangeKey(rangeParam) ? rangeParam : "all";
  const window =
    range === "custom" ? customWindow(first(sp.from), first(sp.to), timezone) : presetWindow(range, timezone, now);

  const filters: TradeFilters = {
    q,
    symbols: symbols.length ? symbols : undefined,
    directions: directions.length ? directions : undefined,
    outcomes: outcome ? [outcome] : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
    from: window.from,
    to: window.to,
    followedPlan,
    importId,
    withoutScreenshot: withoutScreenshot || undefined,
    day,
  };

  const pageSizeParam = Number(first(sp.pageSize));
  return {
    filters,
    filtersActive: Boolean(
      q ||
      symbols.length ||
      directions.length ||
      outcome ||
      tagIds.length ||
      window.from ||
      window.to ||
      followedPlan !== undefined ||
      importId ||
      withoutScreenshot ||
      day,
    ),
    page: Math.max(1, Math.floor(Number(first(sp.page))) || 1),
    pageSize: PAGE_SIZES.includes(pageSizeParam) ? pageSizeParam : 50,
  };
}

/** "7d"/"30d"/"90d"/"ytd" relative to now — a saved "last 7 days" link
 * always means the last 7 days from whenever it is opened. */
function presetWindow(range: string, timezone: string, now: Date): { from?: Date; to?: Date } {
  if (range === "all") return {};
  const { from } = resolveRange(range, timezone, now);
  return { from: from ?? undefined };
}

/** The instant a "YYYY-MM-DD" day (plus `plusDays`) starts in `timezone`. */
function dayStart(day: string, timezone: string, plusDays = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return TZDate.tz(timezone, y, m - 1, d + plusDays).getTime();
}

/** Whole days in the user's timezone: from the start of `from` to the last
 * instant of `to`. Either may be missing; a non-date is ignored. Plain Dates,
 * never TZDates (lib/range.ts, resolveRange, says why). */
function customWindow(from: string | undefined, to: string | undefined, timezone: string): { from?: Date; to?: Date } {
  return {
    from: isJournalDate(from) ? new Date(dayStart(from, timezone)) : undefined,
    to: isJournalDate(to) ? new Date(dayStart(to, timezone, 1) - 1) : undefined,
  };
}

/** One whole local day, first instant to last. */
function dayWindow(day: string, timezone: string): { from: Date; to: Date } {
  return { from: new Date(dayStart(day, timezone)), to: new Date(dayStart(day, timezone, 1) - 1) };
}
