/**
 * Builds coarser bars out of finer ones — the on-the-fly fallback
 * `getBars()` in lib/queries/candles.ts uses when a timeframe was never
 * imported directly, and the reusable core that any future "re-derive H4
 * from stored M1" tooling should call instead of reinventing bucketing.
 *
 * ALIGNMENT: bucket boundaries are anchored to the UTC calendar, never to
 * whatever timestamp the first bar happens to carry. An H4 bar always
 * starts at 00:00/04:00/08:00/12:00/16:00/20:00 UTC — never "four hours
 * after the first row in this particular file". If alignment instead
 * floated with the input, the same M1 data imported starting from two
 * different dates would aggregate into two different sets of H4 bars, and a
 * backtest re-run after a fresh import could silently produce different
 * results than the run before it. Calendar alignment is what makes
 * aggregation reproducible.
 *
 * GAPS: weekends and holidays simply produce no source bars for those
 * buckets, and since buckets are built only from buckets that have at least
 * one source bar (see the Map below), no empty bar is ever emitted for
 * them. There is nothing else to "handle" — an emitted bar with no trades
 * behind it would be fabricated data.
 */

import type { Timeframe } from "@prisma/client";
import type { Bar } from "@/lib/backtest/types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
// 1970-01-01T00:00:00Z was a Thursday; Monday of that same week is 4 days
// later. Anchoring the weekly bucket grid there makes every W1 bucket start
// at 00:00 UTC on a Monday, which is the "calendar week" traders mean.
const WEEK_MONDAY_ANCHOR_MS = 4 * DAY_MS;

const TIMEFRAME_ORDER: readonly Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

const BUCKET_MS: Partial<Record<Timeframe, number>> = {
  M1: MINUTE_MS,
  M5: 5 * MINUTE_MS,
  M15: 15 * MINUTE_MS,
  M30: 30 * MINUTE_MS,
  H1: HOUR_MS,
  H4: 4 * HOUR_MS,
  D1: DAY_MS,
  // W1 is handled separately (bucketStart below) since its grid isn't a
  // fixed-size divisor of the epoch the way every other timeframe's is.
};

function bucketStart(ts: number, timeframe: Timeframe): number {
  if (timeframe === "W1") {
    return Math.floor((ts - WEEK_MONDAY_ANCHOR_MS) / WEEK_MS) * WEEK_MS + WEEK_MONDAY_ANCHOR_MS;
  }
  const size = BUCKET_MS[timeframe];
  if (!size) throw new Error(`Unknown timeframe "${timeframe}".`);
  return Math.floor(ts / size) * size;
}

function mergeBucket(ts: number, group: readonly Bar[]): Bar {
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let hasVolume = false;
  let spread: number | undefined;

  for (const bar of group) {
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
    if (bar.volume !== undefined) {
      volume += bar.volume;
      hasVolume = true;
    }
    if (bar.spread !== undefined) spread = spread === undefined ? bar.spread : Math.max(spread, bar.spread);
  }

  return {
    ts,
    open: group[0].open,
    high,
    low,
    close: group[group.length - 1].close,
    volume: hasVolume ? volume : undefined,
    spread,
  };
}

/**
 * Aggregates `bars` (assumed to be one symbol, all in the `from` timeframe)
 * into `to`. `to` must be the same as or coarser than `from` — building
 * finer bars out of coarser ones would mean fabricating an open/high/low
 * path that never happened, so that's a hard refusal rather than a best
 * effort.
 */
export function aggregateBars(bars: readonly Bar[], from: Timeframe, to: Timeframe): Bar[] {
  const fromIdx = TIMEFRAME_ORDER.indexOf(from);
  const toIdx = TIMEFRAME_ORDER.indexOf(to);
  if (fromIdx === -1) throw new Error(`Unknown timeframe "${from}".`);
  if (toIdx === -1) throw new Error(`Unknown timeframe "${to}".`);
  if (toIdx < fromIdx) {
    throw new Error(`Cannot aggregate ${from} bars into the finer timeframe ${to}.`);
  }
  if (toIdx === fromIdx || bars.length === 0) return [...bars];

  // Bucketing assumes ascending order; never trust the caller sorted it.
  const sorted = [...bars].sort((a, b) => a.ts - b.ts);

  const buckets = new Map<number, Bar[]>();
  for (const bar of sorted) {
    const start = bucketStart(bar.ts, to);
    const group = buckets.get(start);
    if (group) group.push(bar);
    else buckets.set(start, [bar]);
  }

  const starts = [...buckets.keys()].sort((a, b) => a - b);
  return starts.map((start) => mergeBucket(start, buckets.get(start)!));
}
