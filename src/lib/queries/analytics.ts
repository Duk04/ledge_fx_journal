import "server-only";
import { cache } from "react";
import { TZDate } from "@date-fns/tz";
import type { Direction, TagKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  summarize,
  equityCurve,
  drawdownSeries,
  maxDrawdown,
  groupBy,
  rDistribution,
  dailyPnl,
  tradingWeekday,
  ZERO,
} from "@/lib/metrics";
import type { BalanceEvent, Summary, TradeRow } from "@/lib/metrics/types";
import type { Weekday } from "@/lib/metrics/session";
import { toTradeRow } from "@/lib/trade-service";
import { toDecOr, toNum } from "@/lib/decimal-bridge";
import { NotFoundError } from "@/lib/session";
import { RANGE_OPTIONS, isRangeKey, resolveRange, type RangeKey, type DateWindow } from "@/lib/range";

// Re-exported for the pages that already import them from here.
export { RANGE_OPTIONS, isRangeKey, resolveRange };
export type { RangeKey, DateWindow };

/**
 * Reads that power the Overview dashboard and Analytics reports. Every
 * function here takes `{ userId, accountId, from, to }` and returns
 * fully-serialised plain data (numbers/strings/ISO dates) — Prisma's
 * `Decimal` never leaves this file (see src/lib/decimal-bridge.ts), and no
 * function returns a class instance of any kind. The caller (a Server
 * Component) is expected to have already run `requireAccountAccess()`; the
 * account fetch below still filters on `userId` too as defence in depth,
 * and throws `NotFoundError` if the account doesn't belong to the user.
 *
 * ---------------------------------------------------------------------------
 * TWO DIFFERENT NOTIONS OF "IN RANGE" — read this before changing anything.
 * ---------------------------------------------------------------------------
 * The `range` picker (7d/30d/90d/YTD/All) is deliberately applied two
 * different ways, because "which trades happened in this window" and "what
 * did the account balance do during this window" are different questions:
 *
 *  - ACTIVITY window (openedAt-based): used for the performance summary,
 *    every breakdown dimension, the R histogram, the heatmap and the
 *    holding-time buckets. A trade "belongs" to the period it was taken in
 *    — this is also why an OPEN trade (no closedAt yet) still counts here.
 *
 *  - CHRONOLOGICAL window (closedAt/occurredAt-based): used for the equity
 *    curve, the drawdown series and max-drawdown. Balance only moves at the
 *    moment a trade closes or a deposit/withdrawal is recorded, so slicing
 *    by "when did this event land" is the only way the chart's numbers
 *    agree with the account's real balance history. The window's starting
 *    balance is the running balance the instant before `from` (or the
 *    account's starting balance itself, if `from` is null / range = All) —
 *    that is also the value the equity chart's reference line is drawn at.
 *
 * `recentTrades`, `openTrades` and `todayPnl`/`weekPnl`/`monthPnl` ignore
 * the range entirely by design: they answer "what's happening right now",
 * not "how did the selected window go", so re-picking a range shouldn't
 * make the open-positions list or today's P&L disappear.
 */

// ---------------------------------------------------------------------------
// Range handling
// ---------------------------------------------------------------------------



function withinWindow(at: Date, window: DateWindow): boolean {
  if (window.from && at < window.from) return false;
  if (window.to && at > window.to) return false;
  return true;
}

export interface AnalyticsCtx {
  userId: string;
  accountId: string;
  from: Date | null;
  to: Date | null;
}

// ---------------------------------------------------------------------------
// Shared row loading (React-cached per request so overview()/breakdowns()/
// rHistogram()/heatmap()/holdingBuckets() called from the same render pass
// share one DB round trip instead of five).
// ---------------------------------------------------------------------------

/** The full set of fields every view in this file needs from one trade. */
type RawTrade = Awaited<ReturnType<typeof fetchAccountData>>["trades"][number];

const fetchAccountData = cache(async (userId: string, accountId: string) => {
  const account = await prisma.tradingAccount.findFirst({
    where: { id: accountId, userId },
    select: { startingBalance: true, currency: true },
  });
  if (!account) throw new NotFoundError(`Trading account "${accountId}" was not found.`);

  const [user, trades, balanceEvents] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    prisma.trade.findMany({
      where: { accountId, account: { userId } },
      select: {
        id: true,
        symbol: true,
        direction: true,
        status: true,
        openedAt: true,
        closedAt: true,
        entryPrice: true,
        stopLoss: true,
        takeProfit: true,
        volumeLots: true,
        netPnl: true,
        rMultiple: true,
        holdingMinutes: true,
        marketSession: true,
        followedPlan: true,
        emotion: true,
        tradeTags: { select: { tag: { select: { id: true, name: true, kind: true } } } },
      },
      orderBy: { openedAt: "asc" },
    }),
    prisma.balanceEvent.findMany({
      where: { accountId },
      select: { kind: true, amount: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
  ]);

  return { account, timezone: user?.timezone ?? "UTC", trades, balanceEvents };
});

/** One trade plus the extra metadata the breakdown/heatmap/holding-bucket views group by, layered on top of the plain `TradeRow` the metrics module consumes. */
type EnrichedRow = TradeRow & {
  id: string;
  symbol: string;
  direction: Direction;
  marketSession: string | null;
  followedPlan: boolean | null;
  emotion: number | null;
  hasStopLoss: boolean;
  setupTags: { id: string; name: string }[];
};

function enrich(trade: RawTrade): EnrichedRow {
  return {
    ...toTradeRow(trade),
    id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    marketSession: trade.marketSession,
    followedPlan: trade.followedPlan,
    emotion: trade.emotion,
    hasStopLoss: trade.stopLoss !== null,
    setupTags: trade.tradeTags
      .map((tt) => tt.tag)
      .filter((tag): tag is { id: string; name: string; kind: TagKind } => tag.kind === "SETUP"),
  };
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

export interface SerializedSummary {
  tradeCount: number;
  closedCount: number;
  openCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  averageRMultiple: number | null;
  expectancyMoney: number | null;
  expectancyR: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  payoffRatio: number | null;
  standardDeviationR: number | null;
  systemQuality: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: number;
  averageHoldingMinutes: number | null;
  breakevenWinRate: number | null;
}

function serializeSummary(s: Summary): SerializedSummary {
  return {
    tradeCount: s.tradeCount,
    closedCount: s.closedCount,
    openCount: s.openCount,
    wins: s.wins,
    losses: s.losses,
    breakevens: s.breakevens,
    winRate: s.winRate,
    grossProfit: toNum(s.grossProfit) ?? 0,
    grossLoss: toNum(s.grossLoss) ?? 0,
    netPnl: toNum(s.netPnl) ?? 0,
    profitFactor: toNum(s.profitFactor),
    averageWin: toNum(s.averageWin),
    averageLoss: toNum(s.averageLoss),
    averageRMultiple: toNum(s.averageRMultiple),
    expectancyMoney: toNum(s.expectancyMoney),
    expectancyR: toNum(s.expectancyR),
    largestWin: toNum(s.largestWin),
    largestLoss: toNum(s.largestLoss),
    payoffRatio: toNum(s.payoffRatio),
    standardDeviationR: toNum(s.standardDeviationR),
    systemQuality: toNum(s.systemQuality),
    longestWinStreak: s.longestWinStreak,
    longestLossStreak: s.longestLossStreak,
    currentStreak: s.currentStreak,
    averageHoldingMinutes: s.averageHoldingMinutes,
    breakevenWinRate: s.breakevenWinRate,
  };
}

export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  netPnl: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  averageR: number | null;
  grossProfit: number;
  grossLoss: number;
}

function toBreakdownRow(key: string, label: string, s: Summary): BreakdownRow {
  return {
    key,
    label,
    count: s.tradeCount,
    netPnl: toNum(s.netPnl) ?? 0,
    winRate: s.winRate,
    profitFactor: toNum(s.profitFactor),
    expectancyR: toNum(s.expectancyR),
    averageR: toNum(s.averageRMultiple),
    grossProfit: toNum(s.grossProfit) ?? 0,
    grossLoss: toNum(s.grossLoss) ?? 0,
  };
}

const byNetPnlDesc = (a: BreakdownRow, b: BreakdownRow) => b.netPnl - a.netPnl;

function mapGroup<K extends string | number>(
  map: Map<K, Summary>,
  labelFn: (k: K) => string,
  sort: (a: BreakdownRow, b: BreakdownRow) => number = byNetPnlDesc,
): BreakdownRow[] {
  return [...map.entries()].map(([k, s]) => toBreakdownRow(String(k), labelFn(k), s)).sort(sort);
}

// ---------------------------------------------------------------------------
// Human-readable labels for enum-ish keys
// ---------------------------------------------------------------------------

const SESSION_LABELS: Record<string, string> = {
  SYDNEY: "Sydney",
  TOKYO: "Tokyo",
  LONDON: "London",
  NEW_YORK: "New York",
  OVERLAP: "London / NY overlap",
  OFFHOURS: "Off hours",
  UNKNOWN: "Unclassified",
};
const SESSION_ORDER = ["SYDNEY", "TOKYO", "LONDON", "NEW_YORK", "OVERLAP", "OFFHOURS"];

const WEEKDAY_LABELS: Record<string, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};
const WEEKDAY_ORDER: Weekday[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const PLAN_LABELS: Record<string, string> = {
  yes: "Followed plan",
  no: "Deviated from plan",
  unset: "Not recorded",
};

// ---------------------------------------------------------------------------
// overview()
// ---------------------------------------------------------------------------

export interface RecentTrade {
  id: string;
  symbol: string;
  direction: Direction;
  openedAt: string;
  netPnl: number | null;
  rMultiple: number | null;
  marketSession: string | null;
  outcome: string;
}

export interface OpenTrade {
  id: string;
  symbol: string;
  direction: Direction;
  openedAt: string;
  entryPrice: number;
  volumeLots: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface EquityPointDTO {
  at: string;
  balance: number;
  change: number;
  kind: string;
}

export interface DrawdownPointDTO {
  at: string;
  balance: number;
  drawdown: number;
  drawdownPct: number;
}

export interface MaxDrawdownDTO {
  amount: number;
  pct: number;
  peakAt: string;
  troughAt: string;
  recoveredAt: string | null;
  lengthDays: number | null;
}

export interface OverviewData {
  currency: string;
  summary: SerializedSummary;
  equity: EquityPointDTO[];
  /** Balance the moment before the window opened — draw the chart's reference line here, not at the account's all-time starting balance. */
  equityStartBalance: number;
  drawdown: DrawdownPointDTO[];
  maxDrawdown: MaxDrawdownDTO | null;
  dailyPnl: { date: string; netPnl: number; tradeCount: number }[];
  recentTrades: RecentTrade[];
  openTrades: OpenTrade[];
  streak: { current: number; longestWin: number; longestLoss: number };
  todayPnl: number;
  weekPnl: number;
  monthPnl: number;
  discipline: {
    tradeCount: number;
    planFollowedRate: number | null;
    noStopCount: number;
    noStopRate: number | null;
    avgEmotion: number | null;
  };
}

function periodStart(kind: "day" | "week" | "month", timezone: string, now: Date): Date {
  const zoned = new TZDate(now, timezone);
  if (kind === "day") return TZDate.tz(timezone, zoned.getFullYear(), zoned.getMonth(), zoned.getDate());
  if (kind === "month") return TZDate.tz(timezone, zoned.getFullYear(), zoned.getMonth(), 1);
  // Week starts Monday.
  const daysSinceMonday = (zoned.getDay() + 6) % 7;
  return TZDate.tz(timezone, zoned.getFullYear(), zoned.getMonth(), zoned.getDate() - daysSinceMonday);
}

function pnlSince(rows: TradeRow[], since: Date): number {
  const total = rows
    .filter((r) => r.closedAt !== null && r.closedAt >= since)
    .reduce((acc, r) => acc.plus(r.netPnl ?? ZERO), ZERO);
  return toNum(total) ?? 0;
}

export async function overview(ctx: AnalyticsCtx): Promise<OverviewData> {
  const { account, timezone, trades, balanceEvents } = await fetchAccountData(ctx.userId, ctx.accountId);
  const window: DateWindow = { from: ctx.from, to: ctx.to };
  const now = new Date();

  const allRows = trades.map(toTradeRow);
  const startingBalance = toDecOr(account.startingBalance, 0);
  const allEvents: BalanceEvent[] = balanceEvents.map((e) => ({
    at: e.occurredAt,
    amount: toDecOr(e.amount, 0),
    kind: e.kind,
  }));

  // --- ACTIVITY window: trades taken (openedAt) during the selected range ---
  const activityRows = trades.filter((t) => withinWindow(t.openedAt, window)).map(toTradeRow);
  const summary = summarize(activityRows);

  // --- CHRONOLOGICAL window: balance history during the selected range ---
  const fullCurve = equityCurve(allRows, startingBalance, allEvents);
  const equityStartBalance = window.from
    ? (() => {
        const before = fullCurve.filter((p) => p.at < window.from!);
        return before.length ? before[before.length - 1].balance : startingBalance;
      })()
    : startingBalance;

  const chronoRows = trades
    .filter((t) => t.closedAt !== null && withinWindow(t.closedAt, window))
    .map(toTradeRow);
  const chronoEvents = allEvents.filter((e) => withinWindow(e.at, window));
  const windowCurve = equityCurve(chronoRows, equityStartBalance, chronoEvents);
  const windowDrawdown = drawdownSeries(windowCurve);
  const windowMaxDrawdown = maxDrawdown(windowCurve);

  const dailyPnlRows = dailyPnl(chronoRows, timezone).map((p) => ({
    date: p.date,
    netPnl: toNum(p.netPnl) ?? 0,
    tradeCount: p.tradeCount,
  }));

  // --- Always "right now", independent of the range picker ---
  const recentTrades: RecentTrade[] = [...trades]
    .sort((a, b) => (b.closedAt ?? b.openedAt).getTime() - (a.closedAt ?? a.openedAt).getTime())
    .slice(0, 10)
    .map((t) => {
      const row = toTradeRow(t);
      return {
        id: t.id,
        symbol: t.symbol,
        direction: t.direction,
        openedAt: t.openedAt.toISOString(),
        netPnl: toNum(t.netPnl),
        rMultiple: toNum(t.rMultiple),
        marketSession: t.marketSession,
        outcome: row.outcome,
      };
    });

  const openTrades: OpenTrade[] = trades
    .filter((t) => t.status === "OPEN")
    .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
    .map((t) => ({
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      openedAt: t.openedAt.toISOString(),
      entryPrice: toNum(t.entryPrice) ?? 0,
      volumeLots: toNum(t.volumeLots) ?? 0,
      stopLoss: toNum(t.stopLoss),
      takeProfit: toNum(t.takeProfit),
    }));

  const todayPnl = pnlSince(allRows, periodStart("day", timezone, now));
  const weekPnl = pnlSince(allRows, periodStart("week", timezone, now));
  const monthPnl = pnlSince(allRows, periodStart("month", timezone, now));

  const planRows = trades.filter((t) => withinWindow(t.openedAt, window));
  const withPlanRecorded = planRows.filter((t) => t.followedPlan !== null);
  const planFollowedRate = withPlanRecorded.length
    ? withPlanRecorded.filter((t) => t.followedPlan === true).length / withPlanRecorded.length
    : null;
  const noStopCount = planRows.filter((t) => t.stopLoss === null).length;
  const noStopRate = planRows.length ? noStopCount / planRows.length : null;
  const withEmotion = planRows.filter((t) => t.emotion !== null);
  const avgEmotion = withEmotion.length
    ? withEmotion.reduce((acc, t) => acc + (t.emotion as number), 0) / withEmotion.length
    : null;

  return {
    currency: account.currency,
    summary: serializeSummary(summary),
    equity: windowCurve.map((p) => ({
      at: p.at.toISOString(),
      balance: toNum(p.balance) ?? 0,
      change: toNum(p.change) ?? 0,
      kind: p.kind,
    })),
    equityStartBalance: toNum(equityStartBalance) ?? 0,
    drawdown: windowDrawdown.map((p) => ({
      at: p.at.toISOString(),
      balance: toNum(p.balance) ?? 0,
      drawdown: toNum(p.drawdown) ?? 0,
      drawdownPct: toNum(p.drawdownPct) ?? 0,
    })),
    maxDrawdown: windowMaxDrawdown
      ? {
          amount: toNum(windowMaxDrawdown.amount) ?? 0,
          pct: toNum(windowMaxDrawdown.pct) ?? 0,
          peakAt: windowMaxDrawdown.peakAt.toISOString(),
          troughAt: windowMaxDrawdown.troughAt.toISOString(),
          recoveredAt: windowMaxDrawdown.recoveredAt ? windowMaxDrawdown.recoveredAt.toISOString() : null,
          lengthDays: windowMaxDrawdown.lengthDays,
        }
      : null,
    dailyPnl: dailyPnlRows,
    recentTrades,
    openTrades,
    streak: {
      current: summary.currentStreak,
      longestWin: summary.longestWinStreak,
      longestLoss: summary.longestLossStreak,
    },
    todayPnl,
    weekPnl,
    monthPnl,
    discipline: {
      tradeCount: planRows.length,
      planFollowedRate,
      noStopCount,
      noStopRate,
      avgEmotion,
    },
  };
}

// ---------------------------------------------------------------------------
// breakdowns()
// ---------------------------------------------------------------------------

export interface Breakdowns {
  symbol: BreakdownRow[];
  marketSession: BreakdownRow[];
  tag: BreakdownRow[];
  weekday: BreakdownRow[];
  hourOfDay: BreakdownRow[];
  direction: BreakdownRow[];
  followedPlan: BreakdownRow[];
}

function tagBreakdown(rows: EnrichedRow[]): BreakdownRow[] {
  const groups = new Map<string, { label: string; rows: EnrichedRow[] }>();
  for (const row of rows) {
    for (const tag of row.setupTags) {
      const g = groups.get(tag.id);
      if (g) g.rows.push(row);
      else groups.set(tag.id, { label: tag.name, rows: [row] });
    }
  }
  return [...groups.entries()]
    .map(([id, g]) => toBreakdownRow(id, g.label, summarize(g.rows)))
    .sort(byNetPnlDesc);
}

export async function breakdowns(ctx: AnalyticsCtx): Promise<Breakdowns> {
  const { timezone, trades } = await fetchAccountData(ctx.userId, ctx.accountId);
  const window: DateWindow = { from: ctx.from, to: ctx.to };
  const rows = trades.filter((t) => withinWindow(t.openedAt, window)).map(enrich);

  const bySymbol = groupBy(rows, (r) => r.symbol);
  const bySession = groupBy(rows, (r) => r.marketSession ?? "UNKNOWN");
  const byDirection = groupBy(rows, (r) => r.direction);
  const byWeekday = groupBy(rows, (r) => tradingWeekday(r.openedAt, timezone));
  const byHour = groupBy(rows, (r) => new TZDate(r.openedAt, timezone).getHours());
  const byPlan = groupBy(rows, (r) => (r.followedPlan === true ? "yes" : r.followedPlan === false ? "no" : "unset"));

  return {
    symbol: mapGroup(bySymbol, (k) => k),
    marketSession: mapGroup(bySession, (k) => SESSION_LABELS[k] ?? k),
    tag: tagBreakdown(rows),
    weekday: mapGroup(
      byWeekday,
      (k) => WEEKDAY_LABELS[k] ?? k,
      (a, b) => WEEKDAY_ORDER.indexOf(a.key as Weekday) - WEEKDAY_ORDER.indexOf(b.key as Weekday),
    ),
    hourOfDay: mapGroup(
      byHour,
      (k) => `${String(k).padStart(2, "0")}:00`,
      (a, b) => Number(a.key) - Number(b.key),
    ),
    direction: mapGroup(byDirection, (k) => (k === "LONG" ? "Long" : "Short")),
    followedPlan: mapGroup(byPlan, (k) => PLAN_LABELS[k] ?? k),
  };
}

// ---------------------------------------------------------------------------
// rHistogram()
// ---------------------------------------------------------------------------

export interface RHistogramBucket {
  from: number | null;
  to: number | null;
  count: number;
  netPnl: number;
}

/** One row of the Distribution tab's "biggest winners/losers" tables. */
export interface TradeExtreme {
  id: string;
  symbol: string;
  direction: Direction;
  openedAt: string;
  netPnl: number;
  rMultiple: number | null;
}

export interface RHistogramResult {
  buckets: RHistogramBucket[];
  /** Top 5 closed trades by netPnl, descending — the account's best days. */
  topWinners: TradeExtreme[];
  /** Bottom 5 closed trades by netPnl, ascending (most negative first). */
  topLosers: TradeExtreme[];
}

/** Powers the whole Distribution tab: the R histogram, the winners/losers tables, and (via `overview().summary`) the payoff/expectancy figures. */
export async function rHistogram(ctx: AnalyticsCtx): Promise<RHistogramResult> {
  const { trades } = await fetchAccountData(ctx.userId, ctx.accountId);
  const window: DateWindow = { from: ctx.from, to: ctx.to };
  const windowTrades = trades.filter((t) => withinWindow(t.openedAt, window));
  const rows = windowTrades.map(toTradeRow);

  const buckets = rDistribution(rows, 0.5).map((b) => ({
    from: b.from,
    to: b.to,
    count: b.count,
    netPnl: toNum(b.netPnl) ?? 0,
  }));

  const closed = windowTrades.filter((t) => t.status === "CLOSED" && t.netPnl !== null);
  const toExtreme = (t: (typeof closed)[number]): TradeExtreme => ({
    id: t.id,
    symbol: t.symbol,
    direction: t.direction,
    openedAt: t.openedAt.toISOString(),
    netPnl: toNum(t.netPnl) ?? 0,
    rMultiple: toNum(t.rMultiple),
  });
  const bySize = [...closed].sort((a, b) => (toNum(b.netPnl) ?? 0) - (toNum(a.netPnl) ?? 0));
  const topWinners = bySize.slice(0, 5).filter((t) => (toNum(t.netPnl) ?? 0) > 0).map(toExtreme);
  const topLosers = bySize
    .slice(-5)
    .reverse()
    .filter((t) => (toNum(t.netPnl) ?? 0) < 0)
    .map(toExtreme);

  return { buckets, topWinners, topLosers };
}

// ---------------------------------------------------------------------------
// heatmap()
// ---------------------------------------------------------------------------

export interface HeatmapCell {
  weekday: string;
  weekdayLabel: string;
  session: string;
  sessionLabel: string;
  count: number;
  netPnl: number;
  winRate: number | null;
}

export async function heatmap(ctx: AnalyticsCtx): Promise<HeatmapCell[]> {
  const { timezone, trades } = await fetchAccountData(ctx.userId, ctx.accountId);
  const window: DateWindow = { from: ctx.from, to: ctx.to };
  const rows = trades.filter((t) => withinWindow(t.openedAt, window)).map(enrich);

  const cells: HeatmapCell[] = [];
  for (const weekday of WEEKDAY_ORDER) {
    for (const session of SESSION_ORDER) {
      const matching = rows.filter(
        (r) => tradingWeekday(r.openedAt, timezone) === weekday && (r.marketSession ?? "UNKNOWN") === session,
      );
      const s = summarize(matching);
      cells.push({
        weekday,
        weekdayLabel: WEEKDAY_LABELS[weekday],
        session,
        sessionLabel: SESSION_LABELS[session],
        count: s.tradeCount,
        netPnl: toNum(s.netPnl) ?? 0,
        winRate: s.winRate,
      });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// holdingBuckets()
// ---------------------------------------------------------------------------

const HOLDING_BUCKETS: { key: string; label: string; max: number }[] = [
  { key: "lt15m", label: "<15m", max: 15 },
  { key: "15m-1h", label: "15–60m", max: 60 },
  { key: "1h-4h", label: "1–4h", max: 240 },
  { key: "4h-1d", label: "4–24h", max: 1440 },
  { key: "gt1d", label: ">1d", max: Infinity },
];

export async function holdingBuckets(ctx: AnalyticsCtx): Promise<BreakdownRow[]> {
  const { trades } = await fetchAccountData(ctx.userId, ctx.accountId);
  const window: DateWindow = { from: ctx.from, to: ctx.to };
  const rows = trades
    .filter((t) => withinWindow(t.openedAt, window) && t.holdingMinutes !== null)
    .map(toTradeRow);

  let floor = 0;
  return HOLDING_BUCKETS.map((bucket) => {
    const inBucket = rows.filter((r) => {
      const m = r.holdingMinutes as number;
      return m >= floor && m < bucket.max;
    });
    floor = bucket.max;
    return toBreakdownRow(bucket.key, bucket.label, summarize(inBucket));
  });
}
