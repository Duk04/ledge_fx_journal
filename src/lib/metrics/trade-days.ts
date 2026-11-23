/**
 * Trades grouped into calendar days, for the trade list's "Days" view.
 *
 * Judgement calls:
 *
 *  - A TRADE BELONGS TO THE DAY IT CLOSED — or, while it is still open, the
 *    day it opened. That is the month calendar's rule (`monthView`) and the
 *    journal cards' (journal-stats.ts), so a day here, a calendar cell and the
 *    Overview's figures put a trade held overnight on the same day: the one
 *    its result was realised on.
 *
 *  - A day's net P&L is its CLOSED trades only. An open trade is listed under
 *    its day and counted in `tradeCount`, but has no result to add.
 *
 *  - Wins and losses use each row's `outcome`, so a breakeven is neither —
 *    the same reading as every win rate in the app.
 *
 *  - Days come newest first, because this is read as "what did I do lately";
 *    trades inside a day come in the order they happened, because a day is
 *    read as a sequence.
 *
 * Cancelled orders are the caller's to leave out: a `TradeRow` cannot tell
 * one from an open trade, and an order that never filled belongs to no day.
 */
import type { Decimal } from "decimal.js";
import { ZERO } from "./decimal";
import { localDateKey } from "./journal-stats";
import type { TradeRow } from "./types";

export interface TradeDay<T> {
  /** "YYYY-MM-DD" in the requested timezone. */
  date: string;
  /** In the order they happened. */
  rows: T[];
  /** Sum over the day's closed trades. */
  netPnl: Decimal;
  wins: number;
  losses: number;
}

/** The instant that places a trade on a day: its close, or its open while open. */
function placedAt(row: Pick<TradeRow, "openedAt" | "closedAt">): Date {
  return row.closedAt ?? row.openedAt;
}

export function tradeDayKey(row: Pick<TradeRow, "openedAt" | "closedAt">, timeZone: string): string {
  return localDateKey(placedAt(row), timeZone);
}

export function groupByTradeDay<T extends TradeRow>(rows: T[], timeZone: string): TradeDay<T>[] {
  const days = new Map<string, TradeDay<T>>();
  const inOrder = [...rows].sort((a, b) => placedAt(a).getTime() - placedAt(b).getTime());
  for (const row of inOrder) {
    const date = tradeDayKey(row, timeZone);
    const day = days.get(date) ?? { date, rows: [], netPnl: ZERO, wins: 0, losses: 0 };
    day.rows.push(row);
    if (row.closedAt !== null && row.netPnl !== null) day.netPnl = day.netPnl.plus(row.netPnl);
    if (row.outcome === "WIN") day.wins += 1;
    if (row.outcome === "LOSS") day.losses += 1;
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
