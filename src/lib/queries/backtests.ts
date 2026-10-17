import "server-only";
import type { BacktestKind, BacktestStatus, Timeframe } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNum } from "@/lib/decimal-bridge";
import { summarize, equityCurve, maxDrawdown } from "@/lib/metrics";
import { toTradeRow } from "@/lib/trade-service";
import type { TradeRow } from "@/lib/metrics/types";

/**
 * Reads for the backtest UI. Everything here scopes through `userId` — a
 * BacktestRun's `userId` column directly (never inferred through its
 * account), matching the scoping rule in src/lib/session.ts.
 *
 * The one thing this module deliberately does NOT do is trust
 * `BacktestRun.stats` for anything the results page needs to be exactly
 * right. That column exists so `listRuns` (many rows, headline numbers only)
 * doesn't have to re-read and re-summarize every run's trades on every visit
 * to `/backtest` — but `getRun` recomputes the summary and equity curve
 * fresh from the persisted Trade rows, the same way the live journal does,
 * so the results page can never show a number that disagrees with what
 * `/analytics` would compute for the same account.
 */

/** Plain-number rollup stored on `BacktestRun.stats`, JSON-safe. Built from
 * `summarize()` at the end of a run (see actions/backtests.ts) so the list
 * page never has to recompute it. */
export interface RunStats {
  tradeCount: number;
  closedCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  averageRMultiple: number | null;
  expectancyR: number | null;
  expectancyMoney: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  systemQuality: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  maxDrawdownAmount: number | null;
  maxDrawdownPct: number | null;
  barsProcessed: number;
}

export interface RunListRow {
  id: string;
  kind: BacktestKind;
  status: BacktestStatus;
  label: string | null;
  symbol: string;
  timeframe: Timeframe;
  fromTs: string;
  toTs: string;
  strategyName: string | null;
  accountId: string;
  currency: string;
  stats: RunStats | null;
  error: string | null;
  createdAt: string;
}

/**
 * Every run this user owns, newest first. Reads `stats` straight off the
 * row — see the module doc for why the list view is allowed to trust the
 * stored snapshot while `getRun` is not.
 */
export async function listRuns(userId: string): Promise<RunListRow[]> {
  const rows = await prisma.backtestRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      account: { select: { currency: true } },
      strategy: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    label: r.label,
    symbol: r.symbol,
    timeframe: r.timeframe,
    fromTs: r.fromTs.toISOString(),
    toTs: r.toTs.toISOString(),
    strategyName: r.strategy?.name ?? null,
    accountId: r.accountId,
    currency: r.account.currency,
    stats: (r.stats as unknown as RunStats | null) ?? null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface RunTradeRow {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  openedAt: string;
  closedAt: string | null;
  entryPrice: string;
  exitPrice: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  volumeLots: string;
  pips: string | null;
  netPnl: string | null;
  rMultiple: string | null;
  marketSession: string | null;
  notes: string | null;
  digits: number;
}

export interface RunDetail {
  id: string;
  kind: BacktestKind;
  status: BacktestStatus;
  label: string | null;
  symbol: string;
  timeframe: Timeframe;
  fromTs: string;
  toTs: string;
  initialBalance: string;
  currency: string;
  accountId: string;
  digits: number;
  fill: {
    spreadPoints: number;
    commissionPerLot: string;
    slippagePoints: number;
    pessimisticFills: boolean;
  };
  params: Record<string, number | string | boolean> | null;
  strategy: { id: string; name: string; code: string } | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  trades: RunTradeRow[];
  summary: RunStats;
  equity: { ts: number; balance: number }[];
}

/** Full detail for one run, or null if it doesn't exist / belong to `userId`.
 * Recomputes the summary and equity curve fresh from persisted trades — see
 * the module doc. */
export async function getRun(userId: string, id: string): Promise<RunDetail | null> {
  const run = await prisma.backtestRun.findFirst({
    where: { id, userId },
    include: {
      account: { select: { id: true, currency: true, startingBalance: true } },
      strategy: { select: { id: true, name: true, code: true } },
      trades: { orderBy: { openedAt: "asc" } },
    },
  });
  if (!run) return null;

  const instrument = await prisma.instrument.findUnique({ where: { symbol: run.symbol } });
  const digits = instrument?.digits ?? 5;

  const tradeRows: TradeRow[] = run.trades.map(toTradeRow);
  const summary = toRunStats(summarize(tradeRows), run.trades.length);
  const curve = equityCurve(tradeRows, run.initialBalance.toString());
  const dd = maxDrawdown(curve);
  summary.maxDrawdownAmount = dd ? dd.amount.toNumber() : null;
  summary.maxDrawdownPct = dd ? dd.pct.toNumber() : null;

  // How many bars the engine walked is a fact about the run, not about the
  // trades it produced, so it survives only in the stored stats blob.
  const stored = run.stats as { barsProcessed?: number } | null;
  summary.barsProcessed = typeof stored?.barsProcessed === "number" ? stored.barsProcessed : 0;

  const equity: { ts: number; balance: number }[] = [
    { ts: run.fromTs.getTime(), balance: toNum(run.initialBalance) ?? 0 },
    ...curve.map((p) => ({ ts: p.at.getTime(), balance: p.balance.toNumber() })),
  ];

  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    label: run.label,
    symbol: run.symbol,
    timeframe: run.timeframe,
    fromTs: run.fromTs.toISOString(),
    toTs: run.toTs.toISOString(),
    initialBalance: run.initialBalance.toString(),
    currency: run.account.currency,
    accountId: run.accountId,
    digits,
    fill: {
      spreadPoints: run.spreadPoints,
      commissionPerLot: run.commissionPerLot.toString(),
      slippagePoints: run.slippagePoints,
      pessimisticFills: run.pessimisticFills,
    },
    params: (run.params as Record<string, number | string | boolean> | null) ?? null,
    strategy: run.strategy,
    error: run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    trades: run.trades.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      openedAt: t.openedAt.toISOString(),
      closedAt: t.closedAt?.toISOString() ?? null,
      // Backtest trades are always PRICE mode (toJournalTrade), so these are set.
      entryPrice: t.entryPrice?.toString() ?? "0",
      exitPrice: t.exitPrice?.toString() ?? null,
      stopLoss: t.stopLoss?.toString() ?? null,
      takeProfit: t.takeProfit?.toString() ?? null,
      volumeLots: t.volumeLots?.toString() ?? "0",
      pips: t.pips?.toString() ?? null,
      netPnl: t.netPnl?.toString() ?? null,
      rMultiple: t.rMultiple?.toString() ?? null,
      marketSession: t.marketSession,
      notes: t.notes,
      digits,
    })),
    summary,
    equity,
  };
}

/** Shared by `getRun` and `actions/backtests.ts` (which stores the same shape
 * on `BacktestRun.stats`) so the two never drift into different field sets. */
export function toRunStats(summary: ReturnType<typeof summarize>, tradeCount: number): RunStats {
  return {
    tradeCount,
    closedCount: summary.closedCount,
    wins: summary.wins,
    losses: summary.losses,
    breakevens: summary.breakevens,
    winRate: summary.winRate,
    netPnl: summary.netPnl.toNumber(),
    grossProfit: summary.grossProfit.toNumber(),
    grossLoss: summary.grossLoss.toNumber(),
    profitFactor: summary.profitFactor ? summary.profitFactor.toNumber() : null,
    averageRMultiple: summary.averageRMultiple ? summary.averageRMultiple.toNumber() : null,
    expectancyR: summary.expectancyR ? summary.expectancyR.toNumber() : null,
    expectancyMoney: summary.expectancyMoney ? summary.expectancyMoney.toNumber() : null,
    largestWin: summary.largestWin ? summary.largestWin.toNumber() : null,
    largestLoss: summary.largestLoss ? summary.largestLoss.toNumber() : null,
    systemQuality: summary.systemQuality ? summary.systemQuality.toNumber() : null,
    longestWinStreak: summary.longestWinStreak,
    longestLossStreak: summary.longestLossStreak,
    maxDrawdownAmount: null,
    maxDrawdownPct: null,
    // The caller fills this in from the run's stored stats: it is a property of
    // the RUN (how much data the engine walked), not of the resulting trades,
    // so it cannot be recomputed from the trades the way everything else here
    // can be.
    barsProcessed: 0,
  };
}

export interface StrategyListRow {
  id: string;
  name: string;
  description: string | null;
  params: Record<string, number | string | boolean> | null;
  updatedAt: string;
  lastRun: {
    id: string;
    status: BacktestStatus;
    stats: RunStats | null;
    createdAt: string;
  } | null;
}

/** Saved strategies, each with its most recent run's headline numbers (or
 * null if it has never been run). */
export async function listStrategies(userId: string): Promise<StrategyListRow[]> {
  const rows = await prisma.strategy.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, stats: true, createdAt: true },
      },
    },
  });

  return rows.map((s) => {
    const last = s.runs[0];
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      params: (s.params as Record<string, number | string | boolean> | null) ?? null,
      updatedAt: s.updatedAt.toISOString(),
      lastRun: last
        ? {
            id: last.id,
            status: last.status,
            stats: (last.stats as unknown as RunStats | null) ?? null,
            createdAt: last.createdAt.toISOString(),
          }
        : null,
    };
  });
}

export interface StrategyDetail {
  id: string;
  name: string;
  description: string | null;
  code: string;
  params: Record<string, number | string | boolean> | null;
}

export async function getStrategy(userId: string, id: string): Promise<StrategyDetail | null> {
  const s = await prisma.strategy.findFirst({ where: { id, userId } });
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    code: s.code,
    params: (s.params as Record<string, number | string | boolean> | null) ?? null,
  };
}
