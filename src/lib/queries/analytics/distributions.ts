import "server-only";
import type { Direction } from "@prisma/client";
import { type DateWindow } from "@/lib/range";
import { toTradeRow } from "@/lib/trade-service";

import { summarize, rDistribution, tradingWeekday } from "@/lib/metrics";

import { toNum } from "@/lib/decimal-bridge";
import { type AnalyticsCtx, enrich, fetchAccountData, withinWindow } from "./context";
import { SESSION_LABELS, SESSION_ORDER, WEEKDAY_LABELS, WEEKDAY_ORDER } from "./labels";

/** Shape-of-the-edge reports: the R-multiple histogram and the
 * day-of-week/hour-of-day heatmap. */

/** One bar of the R-multiple histogram. */
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
  const topWinners = bySize
    .slice(0, 5)
    .filter((t) => (toNum(t.netPnl) ?? 0) > 0)
    .map(toExtreme);
  const topLosers = bySize
    .slice(-5)
    .reverse()
    .filter((t) => (toNum(t.netPnl) ?? 0) < 0)
    .map(toExtreme);

  return { buckets, topWinners, topLosers };
}

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
