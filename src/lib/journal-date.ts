/**
 * A journal day as every journal URL, action and route carries it —
 * "YYYY-MM-DD" — and as the `@db.Date` column stores it: midnight UTC of that
 * calendar date (docs/JOURNAL.md explains why the string, not a zoned Date, is
 * the source of truth).
 *
 * A regex alone is not a check: "2026-13-01" matches it, becomes an Invalid
 * Date, and makes Prisma throw — which, in a server action, breaks the page
 * instead of returning an error. So a day must also survive a round trip
 * through Date unchanged.
 */
export function isJournalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = toEntryDate(value);
  return !Number.isNaN(d.getTime()) && fromEntryDate(d) === value;
}

export function toEntryDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromEntryDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
