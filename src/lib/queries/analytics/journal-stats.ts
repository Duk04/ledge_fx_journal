import "server-only";

import type { Direction } from "@prisma/client";
import { dailyPnl, equityCurve, summarize } from "@/lib/metrics";
import {
  bestAndWorst,
  bestDay,
  dailyBalance,
  dayWinRate,
  directionSplit,
  durationsByOutcome,
  weekdayHighlights,
  weekdayStats,
  type JournalRow,
} from "@/lib/metrics/journal-stats";
import type { Weekday } from "@/lib/metrics/session";
import type { BalanceEvent } from "@/lib/metrics/types";
import { toDec, toDecOr, toNum } from "@/lib/decimal-bridge";
import { toTradeRow } from "@/lib/trade-service";
import { fetchAccountData, withinWindow, type AnalyticsCtx } from "./context";

/**
 * The journal page's cards and balance chart (docs/JOURNAL.md, "Stats").
 *
 * One window convention throughout: CLOSED trades whose close time falls in
 * the range. The calendar under these cards buckets the same way
 * (`monthView`), so a card, the chart and a day cell never disagree about
 * where a trade's money landed. That differs on purpose from the Overview's
 * "activity" window, which counts trades OPENED in the range.
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
  /** End-of-day balances, opening at the range's first day. */
  balance: { date: string; balance: number }[];
}

export async function journalStats(ctx: AnalyticsCtx & { fromDate: string }): Promise<JournalStats> {
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
      digits: t.instrument.digits,
    }));

  const summary = summarize(rows);
  const days = dailyPnl(rows, timezone);
  const highlights = weekdayHighlights(weekdayStats(rows, timezone));
  const { best, worst } = bestAndWorst(rows);
  const top = bestDay(days, summary.netPnl);

  // Balance: the full history's curve, so the range opens at the balance it
  // actually had then, not at the starting balance.
  const events: BalanceEvent[] = balanceEvents.map((e) => ({
    at: e.occurredAt,
    amount: toDecOr(e.amount, 0),
    kind: e.kind,
  }));
  const curve = equityCurve(trades.map(toTradeRow), toDecOr(account.startingBalance, 0), events);
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
    balance: dailyBalance(inRange, opening, ctx.fromDate, timezone).map((p) => ({
      date: p.date,
      balance: toNum(p.balance) ?? 0,
    })),
  };
}
