import "server-only";

import type { Direction } from "@prisma/client";
import { dailyPnl, equityCurve, summarize } from "@/lib/metrics";
import { groupByDuration, type DurationBucketKey } from "@/lib/metrics/duration";
import {
  bestAndWorst,
  bestDay,
  cumulativePnl,
  dailyBalance,
  dayWinRate,
  directionSplit,
  durationsByOutcome,
  totalLots,
  weekdayHighlights,
  weekdayStats,
  type JournalRow,
} from "@/lib/metrics/journal-stats";
import type { Weekday } from "@/lib/metrics/session";
import { toDec, toDecOr, toNum } from "@/lib/decimal-bridge";
import { toBalanceEvents } from "@/lib/queries/accounts";
import { toTradeRow } from "@/lib/trade-service";
import { fetchAccountData, withinWindow, type AnalyticsCtx } from "./context";

/**
 * The figure cards, daily charts and duration bars of the Overview and the
 * journal page (docs/JOURNAL.md, "Stats").
 *
 * One window convention throughout: CLOSED trades whose close time falls in
 * the range. The calendar under these cards buckets the same way
 * (`monthView`), so a card, a chart and a day cell never disagree about
 * where a trade's money landed. That differs on purpose from `overview()`
 * and the Analytics reports, whose "activity" window counts trades OPENED in
 * the range.
 */

export interface JournalTradeCard {
  id: string;
  symbol: string;
  direction: Direction;
  netPnl: number;
  rMultiple: number | null;
  closedAt: string;
  /** Null on an R-mode trade, which the card then describes in R. */
  entryPrice: number | null;
  exitPrice: number | null;
  /** Price display precision for the instrument. */
  digits: number;
}

export interface JournalStats {
  currency: string;
  tradeCount: number;
  wins: number;
  losses: number;
  netPnl: number;
  winRate: number | null;
  averageWin: number | null;
  /** Positive magnitude. */
  averageLoss: number | null;
  payoffRatio: number | null;
  profitFactor: number | null;
  grossProfit: number;
  /** Positive magnitude. */
  grossLoss: number;
  averageR: number | null;
  dayWin: { greenDays: number; redDays: number; rate: number | null };
  bestDay: { date: string; netPnl: number; shareOfNet: number | null } | null;
  mostActive: { weekday: Weekday; activeDays: number; trades: number } | null;
  mostProfitable: { weekday: Weekday; netPnl: number } | null;
  leastProfitable: { weekday: Weekday; netPnl: number } | null;
  durations: { all: number | null; wins: number | null; losses: number | null };
  direction: { long: number; short: number; longShare: number | null };
  best: JournalTradeCard | null;
  worst: JournalTradeCard | null;
  /** Lots over the trades that have a size; null when none in the range do
   * (trades logged in R carry none). */
  totalLots: { lots: number; sized: number } | null;
  /** End-of-day balances, opening at the range's first day. */
  balance: { date: string; balance: number }[];
  /** Closed-trade P&L per local day that had one. */
  daily: { date: string; netPnl: number; tradeCount: number }[];
  /** Running total of `daily`, opening at zero on the range's first day. */
  cumulative: { date: string; cumulative: number }[];
  /** Always all five holding-time buckets, shortest first. */
  durationBuckets: DurationBucket[];
}

export interface DurationBucket {
  key: DurationBucketKey;
  trades: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses), as everywhere else; null with neither. */
  winRate: number | null;
}

/**
 * `fromDate` is the range's first local day ("YYYY-MM-DD"), where the balance
 * and cumulative lines open; null for an unbounded range, which then opens on
 * its first day with a trade.
 */
export async function journalStats(ctx: AnalyticsCtx & { fromDate: string | null }): Promise<JournalStats> {
  const { account, timezone, trades, balanceEvents } = await fetchAccountData(ctx.userId, ctx.accountId);
  const window = { from: ctx.from, to: ctx.to };

  const rows: (JournalRow & { closedAt: Date; digits: number })[] = trades
    .filter((t) => t.status === "CLOSED" && t.closedAt !== null && withinWindow(t.closedAt, window))
    .map((t) => ({
      ...toTradeRow(t),
      closedAt: t.closedAt!,
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      entryPrice: toDec(t.entryPrice),
      exitPrice: toDec(t.exitPrice),
      volumeLots: toDec(t.volumeLots),
      digits: t.instrument.digits,
    }));

  const summary = summarize(rows);
  const days = dailyPnl(rows, timezone);
  const highlights = weekdayHighlights(weekdayStats(rows, timezone));
  const { best, worst } = bestAndWorst(rows);
  const top = bestDay(days, summary.netPnl);

  const lots = totalLots(rows);

  // Balance: the full history's curve, so the range opens at the balance it
  // actually had then, not at the starting balance. The events go through
  // toBalanceEvents() like every other reader of equityCurve(): this built
  // them by hand, so a WITHDRAWAL stored as a positive magnitude raised the
  // line here while the Overview's equity curve, correctly, dropped.
  const curve = equityCurve(
    trades.map(toTradeRow),
    toDecOr(account.startingBalance, 0),
    toBalanceEvents(balanceEvents),
  );
  const before = ctx.from ? curve.filter((p) => p.at < ctx.from!) : [];
  const opening = before.length ? before[before.length - 1].balance : toDecOr(account.startingBalance, 0);
  const inRange = curve.filter((p) => withinWindow(p.at, window));

  const card = (r: (typeof rows)[number] | null): JournalTradeCard | null =>
    r && {
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      netPnl: toNum(r.netPnl) ?? 0,
      rMultiple: toNum(r.rMultiple),
      closedAt: r.closedAt.toISOString(),
      entryPrice: toNum(r.entryPrice),
      exitPrice: toNum(r.exitPrice),
      digits: r.digits,
    };

  return {
    currency: account.currency,
    tradeCount: rows.length,
    wins: summary.wins,
    losses: summary.losses,
    netPnl: toNum(summary.netPnl) ?? 0,
    winRate: summary.winRate,
    averageWin: toNum(summary.averageWin),
    averageLoss: toNum(summary.averageLoss),
    payoffRatio: toNum(summary.payoffRatio),
    profitFactor: toNum(summary.profitFactor),
    grossProfit: toNum(summary.grossProfit) ?? 0,
    grossLoss: toNum(summary.grossLoss) ?? 0,
    averageR: toNum(summary.averageRMultiple),
    dayWin: dayWinRate(days),
    bestDay: top && { date: top.date, netPnl: toNum(top.netPnl) ?? 0, shareOfNet: toNum(top.shareOfNet) },
    mostActive: highlights.mostActive && {
      weekday: highlights.mostActive.weekday,
      activeDays: highlights.mostActive.activeDays,
      trades: highlights.mostActive.trades,
    },
    mostProfitable: highlights.mostProfitable && {
      weekday: highlights.mostProfitable.weekday,
      netPnl: toNum(highlights.mostProfitable.netPnl) ?? 0,
    },
    leastProfitable: highlights.leastProfitable && {
      weekday: highlights.leastProfitable.weekday,
      netPnl: toNum(highlights.leastProfitable.netPnl) ?? 0,
    },
    durations: durationsByOutcome(rows),
    direction: directionSplit(rows),
    best: card(best),
    worst: card(worst),
    totalLots: lots && { lots: toNum(lots.lots) ?? 0, sized: lots.sized },
    balance: dailyBalance(inRange, opening, ctx.fromDate, timezone).map((p) => ({
      date: p.date,
      balance: toNum(p.balance) ?? 0,
    })),
    daily: days.map((d) => ({ date: d.date, netPnl: toNum(d.netPnl) ?? 0, tradeCount: d.tradeCount })),
    cumulative: cumulativePnl(days, ctx.fromDate).map((p) => ({
      date: p.date,
      cumulative: toNum(p.cumulative) ?? 0,
    })),
    // Each bucket goes through summarize(), so a breakeven is left out of its
    // win rate exactly as it is left out of the "Trade win %" card above.
    durationBuckets: groupByDuration(rows).map((bucket) => {
      const s = summarize(bucket.rows);
      return { key: bucket.key, trades: bucket.rows.length, wins: s.wins, losses: s.losses, winRate: s.winRate };
    }),
  };
}
