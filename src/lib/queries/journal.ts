import "server-only";
import { Decimal } from "decimal.js";
import { TZDate } from "@date-fns/tz";
import { prisma } from "@/lib/db";
import { toDec, toPlain } from "@/lib/decimal-bridge";

/**
 * Journal reads: the month calendar, one day's detail, and the plain list of
 * entries shown under the calendar. Every function here is scoped to the
 * calling user — trades are additionally scoped to one trading account,
 * passed in by the caller (see `resolveActiveTradingAccountId` below).
 */

// ---------------------------------------------------------------------------
// Active-account resolution
// ---------------------------------------------------------------------------

/**
 * Re-exported, not reimplemented.
 *
 * This was a byte-for-byte copy of `resolveActiveAccountId`, justified by a
 * comment claiming `src/lib/active-account.ts` imported a `db` binding that
 * "src/lib/prisma.ts does not export (it only exports prisma), which throws
 * at call time". There is no `src/lib/prisma.ts` in this repository and never
 * has been; `active-account.ts` imports from `@/lib/db` and worked fine. So
 * the copy existed to route around a problem that did not exist, and left two
 * implementations of the tenant-selection rule — the one thing in this app
 * that decides which account's trades a page shows — to be kept in sync by
 * hand.
 *
 * The alias name is kept so the three calling pages are untouched.
 */
export { resolveActiveAccountId as resolveActiveTradingAccountId } from "@/lib/active-account";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

function parseMonth(month: string): { year: number; monthIndex: number; daysInMonth: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Invalid month "${month}", expected "YYYY-MM".`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return { year, monthIndex, daysInMonth };
}

/** "YYYY-MM-DD" for a TZDate, in ITS local calendar (already the target zone). */
function dateKey(zoned: TZDate): string {
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, "0");
  const d = String(zoned.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function firstLine(text: string | null): string | null {
  if (!text) return null;
  const line = text
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  return line ?? null;
}

// ---------------------------------------------------------------------------
// listEntries
// ---------------------------------------------------------------------------

export type MonthEntrySummary = {
  date: string; // YYYY-MM-DD
  mood: number | null;
  /** First non-blank line of the pre-market note, for the list under the calendar. */
  snippet: string | null;
};

/** This month's journal entries, newest first. Pure user scoping — no account involved. */
export async function listEntries(userId: string, month: string): Promise<MonthEntrySummary[]> {
  const { year, monthIndex, daysInMonth } = parseMonth(month);
  const entries = await prisma.journalEntry.findMany({
    where: {
      userId,
      entryDate: {
        gte: new Date(Date.UTC(year, monthIndex, 1)),
        lt: new Date(Date.UTC(year, monthIndex, daysInMonth + 1)),
      },
    },
    orderBy: { entryDate: "desc" },
  });

  return entries.map((e) => ({
    date: e.entryDate.toISOString().slice(0, 10),
    mood: e.mood,
    snippet: firstLine(e.preMarket),
  }));
}

// ---------------------------------------------------------------------------
// monthView
// ---------------------------------------------------------------------------

export type CalendarDay = {
  date: string; // YYYY-MM-DD
  /** Net P&L string for the day's CLOSED trades, or null if there were none. */
  netPnl: string | null;
  /** Every trade touching this local day (open or closed), for the trade-count badge. */
  tradeCount: number;
  hasEntry: boolean;
};

export type MonthView = {
  month: string;
  daysInMonth: number;
  /** One entry per calendar day of the month, in order (day 1 first). */
  days: CalendarDay[];
  /** This month's journal entries, newest first — the list under the calendar. */
  entries: MonthEntrySummary[];
};

/**
 * Everything the month calendar needs in one round trip. `accountId` may be
 * null (a user with no trading accounts yet still has a journal) — in that
 * case every day simply has zero trades.
 */
export async function monthView(
  userId: string,
  accountId: string | null,
  month: string,
  timeZone: string,
): Promise<MonthView> {
  const { year, monthIndex, daysInMonth } = parseMonth(month);

  // Widen the raw fetch window a day on each side of the calendar month: a
  // trade whose UTC timestamp falls just outside the month can still land on
  // an in-month calendar day once shifted into `timeZone` (and vice versa),
  // for any offset from -12:00 to +14:00.
  const rangeStart = new Date(Date.UTC(year, monthIndex, 1) - 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(Date.UTC(year, monthIndex, daysInMonth) + 2 * 24 * 60 * 60 * 1000);

  const [trades, entries] = await Promise.all([
    accountId
      ? prisma.trade.findMany({
          where: {
            accountId,
            account: { userId },
            OR: [
              { closedAt: { gte: rangeStart, lt: rangeEnd } },
              { closedAt: null, openedAt: { gte: rangeStart, lt: rangeEnd } },
            ],
          },
          select: { netPnl: true, openedAt: true, closedAt: true, status: true },
        })
      : Promise.resolve([]),
    listEntries(userId, month),
  ]);

  const bucket = new Map<string, { netPnl: Decimal; tradeCount: number }>();
  for (const t of trades) {
    const localAt = t.closedAt ?? t.openedAt;
    const key = dateKey(new TZDate(localAt, timeZone));
    const existing = bucket.get(key) ?? { netPnl: ZERO, tradeCount: 0 };
    existing.tradeCount += 1;
    if (t.status === "CLOSED") {
      const net = toDec(t.netPnl);
      if (net !== null) existing.netPnl = existing.netPnl.plus(net);
    }
    bucket.set(key, existing);
  }

  const entryDates = new Set(entries.map((e) => e.date));

  const days: CalendarDay[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${month}-${String(day).padStart(2, "0")}`;
    const b = bucket.get(key);
    days.push({
      date: key,
      netPnl: b ? toPlain(b.netPnl) : null,
      tradeCount: b?.tradeCount ?? 0,
      hasEntry: entryDates.has(key),
    });
  }

  return { month, daysInMonth, days, entries };
}

// ---------------------------------------------------------------------------
// dayView
// ---------------------------------------------------------------------------

export type DayTrade = {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED" | "CANCELLED";
  netPnl: string | null;
  rMultiple: string | null;
};

export type DayView = {
  date: string;
  entry: {
    preMarket: string;
    review: string;
    mood: number | null;
    updatedAt: string;
  } | null;
  trades: DayTrade[];
};

/** One calendar day's journal entry (if any) plus the trades that landed on it. */
export async function dayView(
  userId: string,
  accountId: string | null,
  date: string,
  timeZone: string,
): Promise<DayView> {
  const entryDate = new Date(`${date}T00:00:00.000Z`);

  const [entry, trades] = await Promise.all([
    prisma.journalEntry.findUnique({
      where: { userId_entryDate: { userId, entryDate } },
    }),
    accountId ? fetchDayTrades(userId, accountId, date, timeZone) : Promise.resolve([]),
  ]);

  return {
    date,
    entry: entry
      ? {
          preMarket: entry.preMarket ?? "",
          review: entry.review ?? "",
          mood: entry.mood,
          updatedAt: entry.updatedAt.toISOString(),
        }
      : null,
    trades,
  };
}

async function fetchDayTrades(
  userId: string,
  accountId: string,
  date: string,
  timeZone: string,
): Promise<DayTrade[]> {
  const target = new Date(`${date}T00:00:00.000Z`);
  const rangeStart = new Date(target.getTime() - 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(target.getTime() + 2 * 24 * 60 * 60 * 1000);

  const rows = await prisma.trade.findMany({
    where: {
      accountId,
      account: { userId },
      OR: [
        { closedAt: { gte: rangeStart, lt: rangeEnd } },
        { closedAt: null, openedAt: { gte: rangeStart, lt: rangeEnd } },
      ],
    },
    select: {
      id: true,
      symbol: true,
      direction: true,
      status: true,
      netPnl: true,
      rMultiple: true,
      openedAt: true,
      closedAt: true,
    },
    orderBy: { openedAt: "asc" },
  });

  return rows
    .filter((t) => dateKey(new TZDate(t.closedAt ?? t.openedAt, timeZone)) === date)
    .map((t) => ({
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      status: t.status,
      netPnl: toPlain(toDec(t.netPnl)),
      rMultiple: toPlain(toDec(t.rMultiple)),
    }));
}
