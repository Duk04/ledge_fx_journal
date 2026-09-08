import { TZDate } from "@date-fns/tz";

/**
 * The date-range vocabulary, in its own module for one concrete reason: the
 * range picker is a client component, and importing these constants from the
 * analytics query module dragged the entire Prisma/pg driver into the browser
 * bundle. Anything a client component needs to know lives here; anything that
 * touches the database stays in src/lib/queries.
 */

export const RANGE_OPTIONS = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All" },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]["value"];

const RANGE_KEYS = RANGE_OPTIONS.map((o) => o.value);

export function isRangeKey(value: string | undefined): value is RangeKey {
  return !!value && (RANGE_KEYS as readonly string[]).includes(value);
}

/** `to` is always null (unbounded — "up to now"); the shape stays generic so a fixed end date could be added later without touching every call site. */
export interface DateWindow {
  from: Date | null;
  to: Date | null;
}

/** Turns a `range` URL param into a concrete `[from, to]` window, defaulting to 30d for an unrecognised or missing value. */
export function resolveRange(range: string | undefined, timezone: string, now: Date = new Date()): DateWindow {
  const key: RangeKey = isRangeKey(range) ? range : "30d";
  if (key === "all") return { from: null, to: null };
  if (key === "ytd") {
    const zoned = new TZDate(now, timezone);
    const startOfYear = TZDate.tz(timezone, zoned.getFullYear(), 0, 1);
    // Normalised back to a plain Date deliberately. `TZDate` extends Date and
    // its `getTime()` is the correct UTC instant, but it overrides
    // `toISOString()` to emit an offset ("2026-01-01T00:00:00.000+08:00")
    // rather than a Z-suffixed UTC string — and so does `JSON.stringify`.
    // Every DateTime column in this schema is `TIMESTAMP(3)`, i.e. without a
    // time zone, so handing a subclass whose serialisation carries an offset
    // to the driver is a silent-eight-hour-shift waiting to happen. The type
    // here says `Date`; make it one.
    return { from: new Date(startOfYear.getTime()), to: null };
  }
  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
  return { from: new Date(now.getTime() - days * 86_400_000), to: null };
}
