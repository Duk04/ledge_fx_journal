"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { type Prisma, type Timeframe } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, failFields, fieldErrorsFrom, type ActionResult } from "../result";
import { requireUser } from "@/lib/session";
import { lastCloseIn } from "@/lib/queries/candles";
import { toRunStats } from "@/lib/queries/backtests";
import { summarize, equityCurve, maxDrawdown } from "@/lib/metrics";
import { toJournalTrade } from "@/lib/backtest";
import type { SimTrade } from "@/lib/backtest/types";
import { simRunResultSchema } from "@/lib/backtest/sim-trade-schema";
import { BACKTEST_ACCOUNT_CURRENCY, resolveRunConversionRate } from "@/lib/backtest/run-setup";
import { TIMEFRAMES, fillSchema, labelFor, loadInstrumentOrError, simTradesToRows } from "./shared";
import { paramValue } from "./shared";

/**
 * Coded strategy runs.
 *
 * The simulation itself happens in a Web Worker in the author's browser (see
 * src/lib/backtest/worker.ts); this action persists the trades it produced
 * and RECOMPUTES every statistic from them.
 */

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
export async function recordStrategyRun(input: RecordStrategyRunInput): Promise<ActionResult<{ runId: string }>> {
  const parsed = recordStrategyRunSchema.safeParse(input);
  if (!parsed.success) return failFields(fieldErrorsFrom(parsed.error));
  const v = parsed.data;

  const user = await requireUser();

  let strategyId: string | null = null;
  let paramDefaults: Record<string, number | string | boolean> = {};

  if (v.strategyId) {
    const strategy = await prisma.strategy.findFirst({ where: { id: v.strategyId, userId: user.id } });
    if (!strategy) return fail("That strategy was not found.");
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
