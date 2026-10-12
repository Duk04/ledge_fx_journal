import "server-only";
import { prisma } from "@/lib/db";
import { toNum } from "@/lib/decimal-bridge";
import { aggregateBars } from "@/lib/candles/aggregate";
import type { Bar } from "@/lib/backtest/types";
import type { CandleSource, Timeframe } from "@prisma/client";

/**
 * Candle reads. Unlike every other query module in this app, `candles` and
 * `candle_imports`'s bar data are NOT scoped to a single user's data — see
 * prisma/schema.prisma: `Candle` has no `userId`, deliberately, because bar
 * data isn't anyone's private information the way a trade or a journal
 * entry is, and letting every user re-import the same EURUSD history would
 * just multiply storage for no benefit. `CandleImport` (the audit log of
 * *who imported what*) is still user-scoped, which is why `listCoverage`
 * and `listImports` both take a `userId`.
 */

const TIMEFRAME_ORDER: readonly Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

function timeframeMinutes(tf: Timeframe): number {
  switch (tf) {
    case "M1":
      return 1;
    case "M5":
      return 5;
    case "M15":
      return 15;
    case "M30":
      return 30;
    case "H1":
      return 60;
    case "H4":
      return 240;
    case "D1":
      return 1440;
    case "W1":
      return 10080;
  }
}

async function queryStoredBars(params: {
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<Bar[]> {
  const { symbol, timeframe, from, to, limit } = params;

  const tsFilter: { gte?: Date; lte?: Date } = {};
  if (from) tsFilter.gte = from;
  if (to) tsFilter.lte = to;

  // `limit` means "the most recent N bars a caller needs" (e.g. a chart
  // window), so cap by taking the newest rows first and reversing — taking
  // the *oldest* N rows under a limit would silently hand back ancient data
  // when the range is wide, which is never what a limit is for here.
  const rows = await prisma.candle.findMany({
    where: { symbol, timeframe, ...(from || to ? { ts: tsFilter } : {}) },
    orderBy: { ts: limit ? "desc" : "asc" },
    ...(limit ? { take: limit } : {}),
    select: { ts: true, open: true, high: true, low: true, close: true, volume: true, spread: true },
  });

  const ordered = limit ? rows.reverse() : rows;
  return ordered.map((r) => ({
    ts: r.ts.getTime(),
    open: toNum(r.open)!,
    high: toNum(r.high)!,
    low: toNum(r.low)!,
    close: toNum(r.close)!,
    volume: r.volume !== null ? (toNum(r.volume) ?? undefined) : undefined,
    spread: r.spread ?? undefined,
  }));
}

export interface GetBarsResult {
  bars: Bar[];
  timeframe: Timeframe;
  /**
   * Set when the requested timeframe had no stored rows and these bars were
   * built on the fly from a finer stored timeframe instead. `null` means an
   * exact match was found — no aggregation happened.
   */
  aggregatedFrom: Timeframe | null;
}

/**
 * Reads bars for a symbol/timeframe/range.
 *
 * PREFERENCE ORDER when the requested timeframe has no stored rows: try
 * every finer timeframe, from the one immediately below it up to M1, and
 * aggregate from the FIRST one that has data. Aggregating from H1 to build
 * H4, say, produces the same open/high/low/close/volume as aggregating from
 * M1 would (the operations are associative across an aligned bucket grid),
 * so preferring the closest available granularity is purely a performance
 * choice — it reads and merges the fewest rows that still cover the range,
 * rather than always paying for the full M1 detail when a coarser stored
 * timeframe already covers it.
 */
export async function getBars(params: {
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<GetBarsResult> {
  const { symbol, timeframe, from, to, limit } = params;

  const direct = await queryStoredBars({ symbol, timeframe, from, to, limit });
  if (direct.length > 0) {
    return { bars: direct, timeframe, aggregatedFrom: null };
  }

  const idx = TIMEFRAME_ORDER.indexOf(timeframe);
  for (let i = idx - 1; i >= 0; i--) {
    const finer = TIMEFRAME_ORDER[i];
    // No `limit` here: aggregation needs the full source range to build
    // correct buckets, and only the aggregated output gets truncated below.
    const sourceRows = await queryStoredBars({ symbol, timeframe: finer, from, to });
    if (sourceRows.length === 0) continue;

    const aggregated = aggregateBars(sourceRows, finer, timeframe);
    const limited = limit ? aggregated.slice(-limit) : aggregated;
    return { bars: limited, timeframe, aggregatedFrom: finer };
  }

  return { bars: [], timeframe, aggregatedFrom: null };
}

export interface CoverageRow {
  symbol: string;
  timeframe: Timeframe;
  barCount: number;
  firstTs: number;
  lastTs: number;
  source: CandleSource;
  /** A cheap estimate, not an exact count — see the comment below. */
  estimatedGaps: number;
  latestImport: {
    id: string;
    fileName: string | null;
    createdAt: string;
    rowCount: number;
    tzOffsetMinutes: number;
  } | null;
}

/**
 * A rough, deliberately-cheap gap estimate: how many bars a fully continuous
 * Mon-Fri session at this timeframe's cadence would produce between the
 * first and last stored bar, compared to how many actually exist. This is
 * NOT an exact "list every missing timestamp" count — that would mean
 * scanning every row (fine for a few thousand D1 bars, ruinous for tens of
 * millions of M1 rows) — it's a same-ballpark number computed entirely from
 * data already in hand (min ts, max ts, count), cheap enough to show on
 * every row of the coverage table without a second query per symbol.
 * Weekends are excluded from the expected count; broker holidays are not,
 * so real data will always show a few more "gaps" than actually matter.
 */
function estimateGaps(timeframe: Timeframe, firstTs: number, lastTs: number, actualCount: number): number {
  if (lastTs <= firstTs) return 0;
  const stepMs = timeframeMinutes(timeframe) * 60_000;
  if (stepMs >= 7 * 24 * 60 * 60_000) return 0; // W1: "weekday" doesn't apply, and gaps there are rare enough to ignore

  let expected = 0;
  for (let ts = firstTs; ts <= lastTs; ts += stepMs) {
    const day = new Date(ts).getUTCDay();
    if (day !== 0 && day !== 6) expected += 1;
  }
  return Math.max(0, expected - actualCount);
}

/**
 * Per (symbol, timeframe): row count, span, source, and the most recent
 * import that touched it. This is what answers "why does my backtest stop
 * on 12 March" — the coverage table renders straight off this.
 */
export async function listCoverage(userId: string): Promise<CoverageRow[]> {
  const groups = await prisma.candle.groupBy({
    by: ["symbol", "timeframe"],
    _count: { _all: true },
    _min: { ts: true },
    _max: { ts: true },
  });

  return Promise.all(
    groups.map(async (g): Promise<CoverageRow> => {
      const firstTs = g._min.ts!.getTime();
      const lastTs = g._max.ts!.getTime();

      // The source of the most recently-stored bar — if a range was
      // re-imported from a different source, this reflects the newest data,
      // matching what a backtest run against this symbol/timeframe actually reads.
      const latestBar = await prisma.candle.findFirst({
        where: { symbol: g.symbol, timeframe: g.timeframe },
        orderBy: { ts: "desc" },
        select: { source: true },
      });

      const latestImport = await prisma.candleImport.findFirst({
        where: { userId, symbol: g.symbol, timeframe: g.timeframe },
        orderBy: { createdAt: "desc" },
      });

      return {
        symbol: g.symbol,
        timeframe: g.timeframe,
        barCount: g._count._all,
        firstTs,
        lastTs,
        source: latestBar?.source ?? "GENERIC_CSV",
        estimatedGaps: estimateGaps(g.timeframe, firstTs, lastTs, g._count._all),
        latestImport: latestImport
          ? {
              id: latestImport.id,
              fileName: latestImport.fileName,
              createdAt: latestImport.createdAt.toISOString(),
              rowCount: latestImport.rowCount,
              tzOffsetMinutes: latestImport.tzOffsetMinutes,
            }
          : null,
      };
    }),
  );
}

/** `pg_total_relation_size` includes indexes and TOAST, not just the heap —
 * the number a Postgres storage quota (Supabase's included) actually bills. */
export async function candleStorageBytes(): Promise<number> {
  const rows = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_total_relation_size('candles') AS bytes`;
  return Number(rows[0]?.bytes ?? BigInt(0));
}

export interface ImportRow {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  source: CandleSource;
  fileName: string | null;
  rowCount: number;
  fromTs: string;
  toTs: string;
  tzOffsetMinutes: number;
  createdAt: string;
}

export async function listImports(userId: string, limit = 20): Promise<ImportRow[]> {
  const rows = await prisma.candleImport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    source: r.source,
    fileName: r.fileName,
    rowCount: r.rowCount,
    fromTs: r.fromTs.toISOString(),
    toTs: r.toTs.toISOString(),
    tzOffsetMinutes: r.tzOffsetMinutes,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * The close of the last stored bar in a range, or null if the range is empty.
 *
 * Exists so a strategy run's currency conversion rate can be derived on the
 * server without shipping the bars there. The run itself happens in the
 * browser (see src/lib/backtest/worker.ts), and the browser could perfectly
 * well send its own last close — but that number scales every P&L figure the
 * run produces, so it is re-read here rather than trusted. One indexed row.
 *
 * Note this reads only stored bars for the requested timeframe: unlike
 * `getBars`, it does not fall back to aggregating a finer timeframe. For a
 * conversion rate that is the right trade-off — a reference price from a
 * neighbouring timeframe would differ in the last decimal at most, and the
 * caller already handles null by refusing the run.
 */
export async function lastCloseIn(params: {
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
}): Promise<number | null> {
  const { symbol, timeframe, from, to } = params;
  const ts: { gte?: Date; lte?: Date } = {};
  if (from) ts.gte = from;
  if (to) ts.lte = to;

  const row = await prisma.candle.findFirst({
    where: { symbol, timeframe, ...(from || to ? { ts } : {}) },
    orderBy: { ts: "desc" },
    select: { close: true },
  });

  return row ? Number(row.close) : null;
}

/**
 * Bars around one trade, for its chart: the holding period padded by half of
 * itself (at least an hour) on each side, at the coarsest timeframe that
 * still gives ~150 bars — fine enough to see the entry, coarse enough that a
 * week-long trade is not 10,000 M1 bars. Falls back to finer stored data via
 * getBars' aggregation. null when nothing covers the window.
 */
export async function tradeChartBars(trade: { symbol: string; openedAt: Date; closedAt: Date | null }) {
  const end = trade.closedAt ?? new Date();
  const span = Math.max(end.getTime() - trade.openedAt.getTime(), 60_000);
  const pad = Math.max(span / 2, 3_600_000);
  const from = new Date(trade.openedAt.getTime() - pad);
  const to = new Date(end.getTime() + pad);
  const minutes = (to.getTime() - from.getTime()) / 60_000 / 150;
  const TF_MINUTES: [Timeframe, number][] = [
    ["M1", 1],
    ["M5", 5],
    ["M15", 15],
    ["M30", 30],
    ["H1", 60],
    ["H4", 240],
    ["D1", 1440],
  ];
  const start = Math.max(
    0,
    TF_MINUTES.findIndex(([, m]) => m >= minutes),
  );
  for (let i = start; i < TF_MINUTES.length; i++) {
    const { bars, timeframe, aggregatedFrom } = await getBars({
      symbol: trade.symbol,
      timeframe: TF_MINUTES[i][0],
      from,
      to,
    });
    if (bars.length >= 5) return { bars, timeframe, aggregatedFrom };
  }
  return null;
}
