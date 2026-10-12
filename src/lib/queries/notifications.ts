import "server-only";
import { TZDate } from "@date-fns/tz";
import { prisma } from "@/lib/db";
import { toNum } from "@/lib/decimal-bridge";
import { summarize } from "@/lib/metrics";
import { toTradeRow } from "@/lib/trade-service";
import type { WeekAccountRow, WeekTrade } from "@/lib/notifications/templates";

/**
 * Reads behind reminders and summaries. Scoped by `userId` like everything
 * else; the cron route is the only caller that is not acting AS that user,
 * and it passes the id of the row it is working on.
 *
 * "Trading activity" means LIVE, DEMO and PROP accounts. Backtest accounts
 * are filled by replays and strategy runs, which are not a trading day
 * anyone needs to journal, and archived accounts are out of sight on
 * purpose.
 */

export interface NotificationPrefsView {
  journalReminder: boolean;
  weeklySummary: boolean;
  sendHour: number;
  inAppReminder: boolean;
}

/** No row means the defaults — the schema's, restated so a reader of a
 * missing row gets the same answer as a reader of a fresh one. */
export const DEFAULT_PREFS: NotificationPrefsView = {
  journalReminder: false,
  weeklySummary: false,
  sendHour: 20,
  inAppReminder: true,
};

export async function getNotificationPrefs(userId: string): Promise<NotificationPrefsView> {
  const row = await prisma.notificationPrefs.findUnique({
    where: { userId },
    select: { journalReminder: true, weeklySummary: true, sendHour: true, inAppReminder: true },
  });
  return row ?? DEFAULT_PREFS;
}

/** Everyone with at least one email kind switched on. */
export async function listEmailRecipients() {
  return prisma.notificationPrefs.findMany({
    where: { OR: [{ journalReminder: true }, { weeklySummary: true }] },
    select: {
      journalReminder: true,
      weeklySummary: true,
      sendHour: true,
      user: { select: { id: true, email: true, timezone: true, locale: true, emailVerified: true } },
    },
  });
}

const activeAccounts = { isArchived: false, accountType: { not: "BACKTEST" as const } };

/** Trades opened or closed in [from, to). */
export async function countTradingActivity(userId: string, from: Date, to: Date): Promise<number> {
  return prisma.trade.count({
    where: {
      account: { userId, ...activeAccounts },
      OR: [{ openedAt: { gte: from, lt: to } }, { closedAt: { gte: from, lt: to } }],
    },
  });
}

/** Journal rows are keyed by the local calendar date stored as UTC midnight
 * (see queries/journal.ts dayView). */
export async function hasJournalEntry(userId: string, date: string): Promise<boolean> {
  const row = await prisma.journalEntry.findUnique({
    where: { userId_entryDate: { userId, entryDate: new Date(`${date}T00:00:00.000Z`) } },
    select: { id: true },
  });
  return row !== null;
}

function localDateKey(at: Date, timeZone: string): string {
  const d = new TZDate(at, timeZone);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface WeekSummaryData {
  accounts: WeekAccountRow[];
  best: WeekTrade | null;
  worst: WeekTrade | null;
  /** Trading days (local) in the week, and how many of them have an entry. */
  journal: { entries: number; days: number };
}

/** Closed trades in [from, to), per account. null when there were none — a
 * summary of nothing is not worth a mail. */
export async function weekSummary(
  userId: string,
  from: Date,
  to: Date,
  timeZone: string,
): Promise<WeekSummaryData | null> {
  const accounts = await prisma.tradingAccount.findMany({
    where: { userId, ...activeAccounts },
    select: {
      label: true,
      currency: true,
      trades: {
        where: { status: "CLOSED", closedAt: { gte: from, lt: to } },
        select: {
          symbol: true,
          netPnl: true,
          rMultiple: true,
          openedAt: true,
          closedAt: true,
          holdingMinutes: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: WeekAccountRow[] = [];
  const all: WeekTrade[] = [];
  const days = new Set<string>();
  for (const a of accounts) {
    if (a.trades.length === 0) continue;
    const s = summarize(a.trades.map(toTradeRow));
    rows.push({
      label: a.label,
      currency: a.currency,
      trades: a.trades.length,
      netPnl: toNum(s.netPnl) ?? 0,
      winRate: s.winRate,
    });
    for (const t of a.trades) {
      all.push({ symbol: t.symbol, currency: a.currency, netPnl: toNum(t.netPnl) ?? 0 });
      if (t.closedAt) days.add(localDateKey(t.closedAt, timeZone));
    }
  }
  if (rows.length === 0) return null;

  // Best/worst across accounts compare raw amounts, which is only meaningful
  // in one currency; with mixed currencies they are per-trade highlights,
  // not a ranking, and the mail shows each in its own currency.
  const sorted = [...all].sort((x, y) => y.netPnl - x.netPnl);
  const best = sorted[0].netPnl > 0 ? sorted[0] : null;
  const worst = sorted[sorted.length - 1].netPnl < 0 ? sorted[sorted.length - 1] : null;

  const entries = await prisma.journalEntry.count({
    where: {
      userId,
      entryDate: { in: [...days].map((d) => new Date(`${d}T00:00:00.000Z`)) },
    },
  });

  return { accounts: rows, best, worst, journal: { entries, days: days.size } };
}

export interface JournalNudge {
  date: string;
  tradeCount: number;
}

/**
 * The dashboard strip: today (in the user's timezone) had trading activity
 * and has no journal entry yet. null when there is nothing to say, or the
 * user switched the strip off.
 */
export async function journalNudge(userId: string, timeZone: string, now = new Date()): Promise<JournalNudge | null> {
  const prefs = await getNotificationPrefs(userId);
  if (!prefs.inAppReminder) return null;
  const local = new TZDate(now, timeZone);
  const from = new TZDate(local.getFullYear(), local.getMonth(), local.getDate(), timeZone);
  const to = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + 1, timeZone);
  const date = localDateKey(now, timeZone);
  const [tradeCount, written] = await Promise.all([
    countTradingActivity(userId, new Date(from.getTime()), new Date(to.getTime())),
    hasJournalEntry(userId, date),
  ]);
  return tradeCount > 0 && !written ? { date, tradeCount } : null;
}
