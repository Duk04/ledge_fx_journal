/**
 * The extra statistics behind the journal page's cards (docs/JOURNAL.md,
 * "Stats"). Pure functions over closed `JournalRow`s plus the outputs of
 * `dailyPnl` / `equityCurve`; no I/O, decimal.js throughout.
 *
 * Judgement calls, each a decision rather than an accident:
 *
 *  - EVERYTHING HERE BUCKETS BY CLOSE TIME. A trade's result belongs to the
 *    day it was realised. That is the convention the calendar (monthView) and
 *    `dailyPnl` already use, so a card, the balance chart and a calendar cell
 *    can never disagree about which day a trade's money landed on. (The
 *    Analytics weekday table groups by OPEN time, answering a different
 *    question: "which day do I take good trades on".)
 *
 *  - Day win % = green days / (green + red days). A day that nets exactly
 *    zero is left out of both, the same way `summarize` treats a breakeven
 *    trade: a scratch day should not dilute the rate in either direction.
 *
 *  - Best day % of total profit divides by the period's NET P&L, and is null
 *    when that is zero or negative. "Your best day was 2,470% of your
 *    profit" is a real and useful warning (one day carried a flat month); a
 *    percentage of a loss is not a number anyone can read.
 *
 *  - Weekday stats rank only weekdays that had a closed trade. "Least
 *    profitable day: Saturday, $0" for a weekday nobody trades would be true
 *    and useless.
 */
import type { Decimal } from "decimal.js";
import { TZDate } from "@date-fns/tz";
import { ZERO, BREAKEVEN_EPSILON } from "./decimal";
import { tradingWeekday, type Weekday } from "./session";
import type { DailyPnl, Direction, EquityPoint, TradeRow } from "./types";

/** A closed trade plus what the journal cards show about it. */
export interface JournalRow extends TradeRow {
  id: string;
  symbol: string;
  direction: Direction;
  /** Null on an R-mode trade. */
  entryPrice: Decimal | null;
  exitPrice: Decimal | null;
}

function closedOnly<T extends TradeRow>(rows: T[]): (T & { closedAt: Date; netPnl: Decimal })[] {
  return rows.filter((r): r is T & { closedAt: Date; netPnl: Decimal } => r.closedAt !== null && r.netPnl !== null);
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export interface DayWinRate {
  greenDays: number;
  redDays: number;
  /** greenDays / (greenDays + redDays); null when there is neither. */
  rate: number | null;
}

export function dayWinRate(days: DailyPnl[]): DayWinRate {
  const greenDays = days.filter((d) => d.netPnl.gte(BREAKEVEN_EPSILON)).length;
  const redDays = days.filter((d) => d.netPnl.lte(BREAKEVEN_EPSILON.negated())).length;
  const decided = greenDays + redDays;
  return { greenDays, redDays, rate: decided ? greenDays / decided : null };
}

export interface BestDay {
  date: string;
  netPnl: Decimal;
  /** The best day's P&L as a fraction of the period's net P&L (1 = 100%). */
  shareOfNet: Decimal | null;
}

export function bestDay(days: DailyPnl[], periodNet: Decimal): BestDay | null {
  if (days.length === 0) return null;
  const best = days.reduce((a, b) => (b.netPnl.gt(a.netPnl) ? b : a));
  return {
    date: best.date,
    netPnl: best.netPnl,
    shareOfNet: periodNet.gt(0) ? best.netPnl.div(periodNet) : null,
  };
}

// ---------------------------------------------------------------------------
// Weekdays
// ---------------------------------------------------------------------------

export interface WeekdayStat {
  weekday: Weekday;
  trades: number;
  /** Distinct local calendar days of this weekday with a closed trade. */
  activeDays: number;
  netPnl: Decimal;
}

function localDateKey(at: Date, timeZone: string): string {
  const z = new TZDate(at, timeZone);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
}

/** Per-weekday totals by close time, only for weekdays that had a trade. */
export function weekdayStats(rows: TradeRow[], timeZone: string): WeekdayStat[] {
  const map = new Map<Weekday, { trades: number; days: Set<string>; netPnl: Decimal }>();
  for (const r of closedOnly(rows)) {
    const weekday = tradingWeekday(r.closedAt, timeZone);
    const entry = map.get(weekday) ?? { trades: 0, days: new Set<string>(), netPnl: ZERO };
    entry.trades += 1;
    entry.days.add(localDateKey(r.closedAt, timeZone));
    entry.netPnl = entry.netPnl.plus(r.netPnl);
    map.set(weekday, entry);
  }
  return [...map.entries()].map(([weekday, v]) => ({
    weekday,
    trades: v.trades,
    activeDays: v.days.size,
    netPnl: v.netPnl,
  }));
}

export interface WeekdayHighlights {
  /** Most closed trades; ties go to the more profitable day. */
  mostActive: WeekdayStat | null;
  mostProfitable: WeekdayStat | null;
  /** Lowest net P&L — which may still be positive in a good period. */
  leastProfitable: WeekdayStat | null;
}

export function weekdayHighlights(stats: WeekdayStat[]): WeekdayHighlights {
  if (stats.length === 0) return { mostActive: null, mostProfitable: null, leastProfitable: null };
  const byPnl = [...stats].sort((a, b) => b.netPnl.comparedTo(a.netPnl));
  const byCount = [...stats].sort((a, b) => b.trades - a.trades || b.netPnl.comparedTo(a.netPnl));
  return { mostActive: byCount[0], mostProfitable: byPnl[0], leastProfitable: byPnl[byPnl.length - 1] };
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export interface Durations {
  /** Mean minutes held, over closed trades that have a duration. */
  all: number | null;
  wins: number | null;
  losses: number | null;
}

function meanMinutes(rows: TradeRow[]): number | null {
  const mins = rows.map((r) => r.holdingMinutes).filter((m): m is number => m !== null && m !== undefined);
  return mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null;
}

export function durationsByOutcome(rows: TradeRow[]): Durations {
  const closed = closedOnly(rows);
  return {
    all: meanMinutes(closed),
    wins: meanMinutes(closed.filter((r) => r.outcome === "WIN")),
    losses: meanMinutes(closed.filter((r) => r.outcome === "LOSS")),
  };
}

export interface DirectionSplit {
  long: number;
  short: number;
  /** long / (long + short); null with no trades. */
  longShare: number | null;
}

export function directionSplit(rows: JournalRow[]): DirectionSplit {
  const closed = closedOnly(rows);
  const long = closed.filter((r) => r.direction === "LONG").length;
  const short = closed.length - long;
  return { long, short, longShare: closed.length ? long / closed.length : null };
}

/** The single best and worst closed trade by net P&L. Worst is null unless
 * some trade actually lost — the "worst" of an all-green period is not one. */
export function bestAndWorst<T extends JournalRow>(rows: T[]): { best: T | null; worst: T | null } {
  const closed = closedOnly(rows);
  if (closed.length === 0) return { best: null, worst: null };
  const best = closed.reduce((a, b) => (b.netPnl.gt(a.netPnl) ? b : a));
  const worst = closed.reduce((a, b) => (b.netPnl.lt(a.netPnl) ? b : a));
  return { best: best.netPnl.gt(0) ? best : null, worst: worst.netPnl.lt(0) ? worst : null };
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export interface DailyBalancePoint {
  /** "YYYY-MM-DD" in the requested timezone. */
  date: string;
  /** Balance at the end of that local day. */
  balance: Decimal;
}

/**
 * End-of-day balances from an equity curve: one point per local day that had
 * any balance change, carrying that day's last balance. `opening` is the
 * balance before the first point, plotted on `openingDate` so the line starts
 * where the period started rather than after its first trade.
 */
export function dailyBalance(
  curve: EquityPoint[],
  opening: Decimal,
  openingDate: string | null,
  timeZone: string,
): DailyBalancePoint[] {
  const byDay = new Map<string, Decimal>();
  for (const p of curve) byDay.set(localDateKey(p.at, timeZone), p.balance);
  const points = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, balance]) => ({ date, balance }));
  if (openingDate && (points.length === 0 || openingDate < points[0].date)) {
    points.unshift({ date: openingDate, balance: opening });
  }
  return points;
}
