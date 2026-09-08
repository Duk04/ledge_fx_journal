import "server-only";
import type { Direction } from "@prisma/client";
import { type DateWindow } from "@/lib/range";
import { toTradeRow } from "@/lib/trade-service";
import { TZDate } from "@date-fns/tz";
import { summarize, equityCurve, drawdownSeries, maxDrawdown, dailyPnl, ZERO } from "@/lib/metrics";
import type { BalanceEvent, TradeRow } from "@/lib/metrics/types";

import { toDecOr, toNum } from "@/lib/decimal-bridge";
import { type AnalyticsCtx, fetchAccountData, withinWindow } from "./context";
import { type SerializedSummary, serializeSummary } from "./serialize";

/**
 * The Overview dashboard.
 *
 * Note the deliberate asymmetry documented on `AnalyticsCtx`: open positions
 * and today's P&L ignore the selected range, because they answer "what is
 * happening right now" rather than "how did the window go" — re-picking a
 * range should not make the open-positions list disappear.
 */
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
