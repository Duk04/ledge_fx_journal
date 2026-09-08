"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { type Prisma, type Timeframe } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, NotFoundError } from "@/lib/session";
import { getBars, lastCloseIn } from "@/lib/queries/candles";
import { toRunStats } from "@/lib/queries/backtests";
import { classifyOutcome, summarize, equityCurve, maxDrawdown } from "@/lib/metrics";
import type { TradeRow } from "@/lib/metrics/types";
import { toJournalTrade } from "@/lib/backtest";
import type { SimTrade } from "@/lib/backtest/types";
import { simRunResultSchema, simTradeSchema } from "@/lib/backtest/sim-trade-schema";
import { BACKTEST_ACCOUNT_CURRENCY, resolveRunConversionRate } from "@/lib/backtest/run-setup";

export interface ActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string[]>;
  formError?: string;
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;

/** Fewer bars than this can't tell you anything about a strategy or a
 * replay session — refuse rather than run something meaningless. */
const MIN_BARS = 50;
/**
 * Independent of (and tighter than) the engine's own `HARD_BAR_CAP`
 * (1,000,000 — see runner.ts): that cap exists to bound a pathological
 * strategy's runtime once a run is already underway, this one exists so a
 * server action never even starts a run big enough to tie up the request
 * for an unreasonable time. Refusing up front with a clear message beats
 * either silently truncating the requested range or letting the request
 * hang.
 */
const MAX_BARS = 500_000;

const fillSchema = z.object({
  spreadPoints: z.coerce.number().int().min(0).max(100_000),
  commissionPerLot: z.coerce.number().min(0).max(100_000),
  slippagePoints: z.coerce.number().int().min(0).max(100_000),
  pessimisticFills: z.boolean().default(true),
});

/** Backtest accounts are always opened in USD — see docs/BACKTEST.md's
 * design-decision section. Nothing in the run/replay forms asks for a
 * currency, so there is nowhere else this could come from. */

async function loadInstrumentOrError(symbol: string) {
  const instrument = await prisma.instrument.findUnique({ where: { symbol } });
  if (!instrument) {
    return { error: { ok: false, formError: `"${symbol}" is not a known instrument.` } as ActionResult };
  }
  return { instrument };
}

function labelFor(kind: "Replay" | "Strategy" | string, symbol: string, timeframe: string, from: Date): string {
  const dateLabel = from.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  return `${kind} · ${symbol} ${timeframe} · ${dateLabel}`;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

const createReplaySchema = z
  .object({
    symbol: z.string().trim().min(1, "Choose a symbol."),
    timeframe: z.enum(TIMEFRAMES, { message: "Choose a timeframe." }),
    from: z.coerce.date({ message: "Choose a start date." }),
    to: z.coerce.date({ message: "Choose an end date." }),
    initialBalance: z.coerce.number().positive("Must be greater than zero."),
  })
  .extend(fillSchema.shape)
  .refine((v) => v.to > v.from, { message: "End date must be after the start date.", path: ["to"] });

export type CreateReplayInput = z.input<typeof createReplaySchema>;

/**
 * Creates the BACKTEST account + BacktestRun a replay session writes into.
 * No trades are simulated here — replay is driven bar-by-bar in the browser
 * (see components/backtest/replay); this just opens the ledger it writes to.
 */
export async function createReplayRun(input: CreateReplayInput): Promise<ActionResult & { runId?: string }> {
  const parsed = createReplaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  const v = parsed.data;

  const user = await requireUser();

  const { bars } = await getBars({ symbol: v.symbol, timeframe: v.timeframe as Timeframe, from: v.from, to: v.to });
  if (bars.length < MIN_BARS) {
    return {
      ok: false,
      formError: `Only ${bars.length} bar(s) of ${v.symbol} ${v.timeframe} are stored in that range — a replay needs at least ${MIN_BARS}. Import more data or widen the range.`,
    };
  }
  if (bars.length > MAX_BARS) {
    return {
      ok: false,
      formError: `That range has ${bars.length.toLocaleString()} bars, over the ${MAX_BARS.toLocaleString()}-bar limit for one run — narrow the date range.`,
    };
  }

  const label = labelFor("Replay", v.symbol, v.timeframe, v.from);

  const runId = await prisma.$transaction(async (tx) => {
    const account = await tx.tradingAccount.create({
      data: {
        userId: user.id,
        label,
        platform: "OTHER",
        accountType: "BACKTEST",
        currency: BACKTEST_ACCOUNT_CURRENCY,
        startingBalance: v.initialBalance.toFixed(2),
      },
    });

    const run = await tx.backtestRun.create({
      data: {
        userId: user.id,
        accountId: account.id,
        kind: "REPLAY",
        status: "DRAFT",
        label,
        symbol: v.symbol,
        timeframe: v.timeframe as Timeframe,
        fromTs: v.from,
        toTs: v.to,
        initialBalance: v.initialBalance.toFixed(2),
        spreadPoints: v.spreadPoints,
        commissionPerLot: v.commissionPerLot.toFixed(2),
        slippagePoints: v.slippagePoints,
        pessimisticFills: v.pessimisticFills,
        startedAt: new Date(),
      },
    });

    return run.id;
  });

  revalidatePath("/backtest");
  return { ok: true, runId };
}

/**
 * Persists one trade the replay UI just closed. The client computed `trade`
 * itself, bar by bar, using the exact same `entryPrice`/`exitOnBar`/
 * `closeAtPrice` functions the engine uses (see
 * components/backtest/replay/use-replay-engine.ts) — this action's job is
 * only to check ownership and write the row, via the same `toJournalTrade`
 * boundary a strategy run uses. After each insert the run's stored stats are
 * refreshed from every trade recorded so far, so the run list and results
 * page never have to distinguish "still replaying" from "finished".
 */
export async function recordReplayTrade(runId: string, trade: SimTrade): Promise<ActionResult> {
  const parsed = simTradeSchema.safeParse(trade);
  if (!parsed.success) return { ok: false, formError: "That trade wasn't shaped like a finished trade." };

  const user = await requireUser();
  const run = await prisma.backtestRun.findFirst({ where: { id: runId, userId: user.id } });
  if (!run) return { ok: false, formError: "That replay run was not found." };
  if (run.kind !== "REPLAY") return { ok: false, formError: "This run isn't a replay session." };

  const journalInput = toJournalTrade(parsed.data, {
    accountId: run.accountId,
    symbol: run.symbol,
    backtestRunId: run.id,
  });

  await prisma.$transaction(async (tx) => {
    await tx.trade.create({
      data: {
        accountId: journalInput.accountId,
        symbol: journalInput.symbol,
        direction: journalInput.direction,
        status: journalInput.status,
        openedAt: journalInput.openedAt,
        closedAt: journalInput.closedAt,
        entryPrice: journalInput.entryPrice,
        exitPrice: journalInput.exitPrice,
        stopLoss: journalInput.stopLoss,
        takeProfit: journalInput.takeProfit,
        volumeLots: journalInput.volumeLots,
        commission: journalInput.commission,
        grossPnl: journalInput.grossPnl,
        netPnl: journalInput.netPnl,
        pips: journalInput.pips,
        rMultiple: journalInput.rMultiple,
        riskAmount: journalInput.riskAmount,
        holdingMinutes: journalInput.holdingMinutes,
        marketSession: journalInput.marketSession,
        backtestRunId: journalInput.backtestRunId,
        notes: journalInput.notes,
      },
    });

    const allTrades = await tx.trade.findMany({ where: { backtestRunId: run.id } });
    const rows: TradeRow[] = allTrades.map((t) => ({
      netPnl: t.netPnl ? new Decimal(t.netPnl.toString()) : null,
      rMultiple: t.rMultiple ? new Decimal(t.rMultiple.toString()) : null,
      outcome: classifyOutcome(t.netPnl ? new Decimal(t.netPnl.toString()) : null, "CLOSED"),
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      holdingMinutes: t.holdingMinutes,
    }));
    const stats = toRunStats(summarize(rows), allTrades.length);
    const curve = equityCurve(rows, run.initialBalance.toString());
    const dd = maxDrawdown(curve);
    stats.maxDrawdownAmount = dd ? dd.amount.toNumber() : null;
    stats.maxDrawdownPct = dd ? dd.pct.toNumber() : null;
    stats.barsProcessed = allTrades.length;

    await tx.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "DONE",
        finishedAt: new Date(),
        stats: stats as unknown as Prisma.InputJsonValue,
      },
    });
  });

  revalidatePath("/backtest");
  revalidatePath(`/backtest/runs/${run.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Strategy runs
// ---------------------------------------------------------------------------

const paramValue = z.union([z.number(), z.string(), z.boolean()]);

const recordStrategyRunSchema = z
  .object({
    /** Present when the run came from a saved strategy: used to check
     * ownership, to seed `params`, and to link the run. Absent for a run of
     * unsaved code in the editor, which the server needs no copy of. */
    strategyId: z.string().optional(),
    symbol: z.string().trim().min(1, "Choose a symbol."),
    timeframe: z.enum(TIMEFRAMES, { message: "Choose a timeframe." }),
    from: z.coerce.date({ message: "Choose a start date." }),
    to: z.coerce.date({ message: "Choose an end date." }),
    initialBalance: z.coerce.number().positive("Must be greater than zero."),
    params: z.record(z.string(), paramValue).optional(),
    /** What the browser's worker produced. Trades only — never statistics;
     * those are recomputed below. */
    result: simRunResultSchema,
  })
  .extend(fillSchema.shape)
  .refine((v) => v.to > v.from, { message: "End date must be after the start date.", path: ["to"] });

export type RecordStrategyRunInput = z.input<typeof recordStrategyRunSchema>;

/** Converts a finished `SimTrade` array straight into `TradeRow`s for
 * `summarize()`/`equityCurve()`, without a DB round-trip — the run's own
 * numbers should reflect exactly what `runBacktest` produced. */
function simTradesToRows(trades: SimTrade[]): TradeRow[] {
  return trades.map((t) => {
    const netPnl = new Decimal(t.netPnl);
    return {
      netPnl,
      rMultiple: t.rMultiple === null ? null : new Decimal(t.rMultiple),
      outcome: classifyOutcome(netPnl, "CLOSED"),
      openedAt: new Date(t.entryTs),
      closedAt: new Date(t.exitTs),
      holdingMinutes: t.holdingMinutes,
    };
  });
}

/**
 * Persists a strategy run the browser just finished.
 *
 * WHY THE SIMULATION IS NOT HERE
 *
 * This action used to compile and run the strategy itself, which meant
 * `new Function` executing author-supplied JavaScript inside the Node
 * process. With open registration that is remote code execution, and the
 * sandbox cannot be hardened into a fix — `"".constructor.constructor`
 * reaches the real `Function` from a bare string literal, naming nothing an
 * allowlist could cover (see src/lib/backtest/sandbox.ts, and the tests in
 * sandbox.test.ts that assert the escapes work).
 *
 * So the run happens in a Web Worker in the author's own browser, on the
 * author's own code, where the blast radius is their own tab and the host
 * page can `terminate()` a runaway strategy — something the server never
 * could, since `runBacktest`'s timeout only fires between bars and a hang
 * inside one `onBar` call pinned the request.
 *
 * WHAT THAT MEANS FOR TRUST, STATED PLAINLY
 *
 * A caller can post any trades it likes, so a user can fabricate their own
 * backtest results. That is accepted, for reasons spelled out in
 * docs/BACKTEST.md: the rows land in a fresh BACKTEST account owned by that
 * user, every read path in the app is scoped by userId, and `recordReplayTrade`
 * below has worked exactly this way since day one. The tripwire is also in
 * that doc — if a shared, public or comparative view of results is ever
 * added, this assumption breaks and the simulation has to move somewhere
 * trustworthy.
 *
 * What is NOT trusted, even so:
 *   - Statistics. Win rate, expectancy, equity curve and drawdown are
 *     recomputed here from the posted trades with the same functions the rest
 *     of the app uses, so a client cannot post numbers that disagree with the
 *     trades they claim to summarise.
 *   - The conversion rate, which scales every P&L figure: re-read from the
 *     last stored bar rather than taken from the request.
 *   - Volume. `simRunResultSchema` caps the trade array; without that, a
 *     client could post ten million trades into one `createMany`.
 *   - Strategy ownership, as before.
 */
export async function recordStrategyRun(
  input: RecordStrategyRunInput,
): Promise<ActionResult & { runId?: string }> {
  const parsed = recordStrategyRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  const v = parsed.data;

  const user = await requireUser();

  let strategyId: string | null = null;
  let paramDefaults: Record<string, number | string | boolean> = {};

  if (v.strategyId) {
    const strategy = await prisma.strategy.findFirst({ where: { id: v.strategyId, userId: user.id } });
    if (!strategy) return { ok: false, formError: "That strategy was not found." };
    strategyId = strategy.id;
    paramDefaults = (strategy.params as Record<string, number | string | boolean> | null) ?? {};
  }

  const { instrument, error: instrumentError } = await loadInstrumentOrError(v.symbol);
  if (instrumentError) return instrumentError;

  // Re-derived, not trusted: this single number scales every P&L in the run.
  const lastClose = await lastCloseIn({
    symbol: v.symbol,
    timeframe: v.timeframe as Timeframe,
    from: v.from,
    to: v.to,
  });
  if (lastClose === null) {
    return {
      ok: false,
      formError: `No ${v.symbol} ${v.timeframe} bars are stored in that range, so this run can't be recorded. Import data for it first.`,
    };
  }

  // Stored alongside the strategy's own parameters so a run's numbers can be
  // explained later: every P&L figure in it was scaled by this one rate, and
  // it is not otherwise recoverable once the bars have moved on. This is the
  // record `resolveRunConversionRate`'s doc refers to.
  const conversionRate = resolveRunConversionRate(instrument, lastClose);
  const params = { ...paramDefaults, ...(v.params ?? {}), conversionRate };
  const trades = v.result.trades;

  const label = labelFor("Strategy", v.symbol, v.timeframe, v.from);
  const rows = simTradesToRows(trades);
  const summary = toRunStats(summarize(rows), trades.length);
  const curve = equityCurve(rows, v.initialBalance);
  const dd = maxDrawdown(curve);
  summary.maxDrawdownAmount = dd ? dd.amount.toNumber() : null;
  summary.maxDrawdownPct = dd ? dd.pct.toNumber() : null;
  summary.barsProcessed = v.result.barsProcessed;

  const runId = await prisma.$transaction(async (tx) => {
    const account = await tx.tradingAccount.create({
      data: {
        userId: user.id,
        label,
        platform: "OTHER",
        accountType: "BACKTEST",
        currency: BACKTEST_ACCOUNT_CURRENCY,
        startingBalance: v.initialBalance.toFixed(2),
      },
    });

    const run = await tx.backtestRun.create({
      data: {
        userId: user.id,
        accountId: account.id,
        strategyId,
        kind: "STRATEGY",
        status: trades.length === 0 && v.result.error ? "FAILED" : "DONE",
        label,
        symbol: v.symbol,
        timeframe: v.timeframe as Timeframe,
        fromTs: v.from,
        toTs: v.to,
        initialBalance: v.initialBalance.toFixed(2),
        spreadPoints: v.spreadPoints,
        commissionPerLot: v.commissionPerLot.toFixed(2),
        slippagePoints: v.slippagePoints,
        pessimisticFills: v.pessimisticFills,
        params: params as unknown as Prisma.InputJsonValue,
        stats: summary as unknown as Prisma.InputJsonValue,
        error: v.result.error ?? null,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    if (trades.length > 0) {
      const data: Prisma.TradeCreateManyInput[] = trades.map((t) => {
        // The conversion rate the client used is irrelevant here: toJournalTrade
        // works from the trade's own already-converted figures. The rate is
        // stored on the run for provenance, and re-derived above so the value
        // recorded is the server's.
        const j = toJournalTrade(t as SimTrade, {
          accountId: account.id,
          symbol: v.symbol,
          backtestRunId: run.id,
        });
        return {
          accountId: j.accountId,
          symbol: j.symbol,
          direction: j.direction,
          status: j.status,
          openedAt: j.openedAt,
          closedAt: j.closedAt,
          entryPrice: j.entryPrice,
          exitPrice: j.exitPrice,
          stopLoss: j.stopLoss,
          takeProfit: j.takeProfit,
          volumeLots: j.volumeLots,
          commission: j.commission,
          grossPnl: j.grossPnl,
          netPnl: j.netPnl,
          pips: j.pips,
          rMultiple: j.rMultiple,
          riskAmount: j.riskAmount,
          holdingMinutes: j.holdingMinutes,
          marketSession: j.marketSession,
          backtestRunId: j.backtestRunId,
          notes: j.notes,
        };
      });
      await tx.trade.createMany({ data });
    }

    return run.id;
  });

  revalidatePath("/backtest");
  revalidatePath("/backtest/strategies");
  return { ok: true, runId };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a run and its trades (the FK from Trade -> BacktestRun cascades —
 * see prisma/schema.prisma). The run's own account is cleaned up too, but
 * only once nothing else points at it: the schema allows an account to hold
 * more than one run, even though every creation path here only ever makes
 * one-run-per-account accounts, so this checks rather than assumes.
 */
export async function deleteRun(id: string): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await prisma.$transaction(async (tx) => {
      const run = await tx.backtestRun.findFirst({ where: { id, userId: user.id } });
      if (!run) throw new NotFoundError("That run was not found.");

      await tx.backtestRun.delete({ where: { id } });

      const remaining = await tx.backtestRun.count({ where: { accountId: run.accountId } });
      if (remaining === 0) {
        await tx.tradingAccount.delete({ where: { id: run.accountId } });
      }
    });
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, formError: err.message };
    throw err;
  }

  revalidatePath("/backtest");
  return { ok: true };
}
