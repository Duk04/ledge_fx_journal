/**
 * Holding-time buckets: how long a position was open, cut into five ranges.
 *
 * The edges lived in the query layer (analytics/labels.ts) with the bucketing
 * loop beside them and no test. Two reports now cut the same way — Analytics'
 * holding-time table over trades OPENED in the range, and the Overview's
 * duration bars over trades CLOSED in it — so the cut is here, once, and each
 * caller keeps only its own window filter.
 *
 * Judgement calls:
 *
 *  - A bucket's upper edge is EXCLUSIVE: a trade held exactly 15 minutes is
 *    "15–60m", not "<15m". Holding time is stored in whole minutes, so 14 and
 *    15 are the two sides of that line.
 *
 *  - Every bucket is always returned, in order, empty or not. A chart whose
 *    rows appear and disappear with the range cannot be compared by eye.
 *
 *  - A row with no holding time (still open, or never computed) is in no
 *    bucket. So is a negative one: a close before the open is bad data, and
 *    "<15m" is not where it belongs.
 */
import type { TradeRow } from "./types";

export const DURATION_BUCKETS = [
  { key: "lt15m", max: 15 },
  { key: "15m-1h", max: 60 },
  { key: "1h-4h", max: 240 },
  { key: "4h-1d", max: 1440 },
  { key: "gt1d", max: Infinity },
] as const;

export type DurationBucketKey = (typeof DURATION_BUCKETS)[number]["key"];

export function groupByDuration<T extends Pick<TradeRow, "holdingMinutes">>(
  rows: T[],
): { key: DurationBucketKey; rows: T[] }[] {
  let floor = 0;
  return DURATION_BUCKETS.map((bucket) => {
    const min = floor;
    floor = bucket.max;
    return {
      key: bucket.key,
      rows: rows.filter((r) => {
        const m = r.holdingMinutes;
        return m !== null && m !== undefined && m >= min && m < bucket.max;
      }),
    };
  });
}
