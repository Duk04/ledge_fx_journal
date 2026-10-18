import "server-only";
import { prisma } from "@/lib/db";

/**
 * The daily checklist (docs/JOURNAL.md, "Daily checklist"): the user's own
 * list of things to look at before trading, and which of them were ticked
 * on a given calendar day.
 *
 * `date` is a plain "YYYY-MM-DD" calendar date, stored as @db.Date at UTC
 * midnight exactly like JournalEntry.entryDate — a day the user is writing
 * about, with no instant to convert.
 */

export interface DailyChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  /** Removed from the list since, but ticked on this day — shown so the
   * day's record stays whole, and read-only. */
  archived: boolean;
}

export interface DailyChecklist {
  date: string;
  items: DailyChecklistItem[];
  done: number;
  total: number;
}

export function checklistDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * The list as it stands for `date`: every active item, plus any archived
 * item that was ticked that day. An item removed from the list does not
 * vanish from the days it was part of.
 */
export async function dailyChecklist(userId: string, date: string): Promise<DailyChecklist> {
  const day = checklistDate(date);
  const rows = await prisma.checklistItem.findMany({
    where: { userId, OR: [{ archivedAt: null }, { checks: { some: { date: day } } }] },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, text: true, archivedAt: true, checks: { where: { date: day }, select: { itemId: true } } },
  });
  const items = rows.map((r) => ({
    id: r.id,
    text: r.text,
    checked: r.checks.length > 0,
    archived: r.archivedAt !== null,
  }));
  return { date, items, done: items.filter((i) => i.checked).length, total: items.length };
}

/** How many items were ticked on each day between `from` and `to`
 * (inclusive "YYYY-MM-DD"), for the calendar. Days with none are absent. */
export async function checksPerDay(userId: string, from: string, to: string): Promise<Map<string, number>> {
  const rows = await prisma.dailyCheck.groupBy({
    by: ["date"],
    where: { item: { userId }, date: { gte: checklistDate(from), lte: checklistDate(to) } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r._count._all]));
}
