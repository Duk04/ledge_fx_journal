/**
 * Small calendar-string helpers shared by the month and day journal views.
 * These deliberately do all their arithmetic in UTC on a "YYYY-MM[-DD]"
 * string, never on a timezone-sensitive `Date` — the strings themselves are
 * already the correct local calendar values (see docs/JOURNAL.md), so the
 * only job left here is calendar math, not timezone conversion.
 */

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Today's date ("YYYY-MM-DD") and month ("YYYY-MM") as seen in `timeZone`. */
export function todayIn(timeZone: string): { date: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
  return { date: `${map.year}-${map.month}-${map.day}`, month: `${map.year}-${map.month}` };
}

export function isValidMonth(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value);
}

export function isValidDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
