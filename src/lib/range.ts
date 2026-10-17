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

// ---------------------------------------------------------------------------
// The journal's calendar ranges (docs/JOURNAL.md, "Stats")
// ---------------------------------------------------------------------------

/**
 * The journal page picks calendar DATES, not rolling durations: "last month"
 * there means "the same day last month through today" in the user's own
 * timezone, and the window it produces has a real end (`to` = end of the
 * `to` day), so a past range stays the past range. The rolling 7d/30d above
 * is the dashboard's vocabulary and answers a different question.
 */
export const JOURNAL_PRESETS = ["today", "lastWeek", "lastMonth"] as const;
export type JournalPreset = (typeof JOURNAL_PRESETS)[number];

export interface JournalRange {
  /** "YYYY-MM-DD" in the user's timezone, inclusive. */
  from: string;
  to: string;
  /** The preset these dates are, if any — for the button to light up. */
  preset: JournalPreset | null;
  window: { from: Date; to: Date };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function ymd(z: TZDate): string {
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
}

function isRealDate(s: string | undefined): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** The dates each preset stands for, as of `now` in `timezone`. */
export function journalPresetDates(
  timezone: string,
  now: Date = new Date(),
): Record<JournalPreset, { from: string; to: string }> {
  const today = new TZDate(now, timezone);
  const shifted = (days: number, months = 0) =>
    ymd(TZDate.tz(timezone, today.getFullYear(), today.getMonth() - months, today.getDate() - days));
  const to = ymd(today);
  return {
    today: { from: to, to },
    lastWeek: { from: shifted(7), to },
    lastMonth: { from: shifted(0, 1), to },
  };
}

/**
 * `?from=&to=` -> a concrete window. Missing, malformed or reversed dates
 * fall back to the last month. Like `resolveRange`, the instants are plain
 * Dates, never TZDates (see the comment there).
 */
export function resolveJournalRange(
  params: { from?: string; to?: string },
  timezone: string,
  now: Date = new Date(),
): JournalRange {
  const presets = journalPresetDates(timezone, now);
  const valid = isRealDate(params.from) && isRealDate(params.to) && params.from <= params.to;
  const from = valid ? params.from! : presets.lastMonth.from;
  const to = valid ? params.to! : presets.lastMonth.to;
  const preset = JOURNAL_PRESETS.find((p) => presets[p].from === from && presets[p].to === to) ?? null;

  const start = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return TZDate.tz(timezone, y, m - 1, d).getTime();
  };
  const [ty, tm, td] = to.split("-").map(Number);
  const endExclusive = TZDate.tz(timezone, ty, tm - 1, td + 1).getTime();
  return { from, to, preset, window: { from: new Date(start(from)), to: new Date(endExclusive - 1) } };
}
