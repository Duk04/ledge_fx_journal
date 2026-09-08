import { z } from 'zod'

/**
 * Validation for a finished simulated trade arriving from the browser.
 *
 * Both paths that write backtest trades are client-computed — manual replay
 * closes one trade at a time, a strategy run posts the whole array — so this
 * schema is the trust boundary for every number that reaches a Prisma
 * `Decimal` column. It lives here, apart from the action modules, so it can
 * be unit-tested: importing `src/lib/actions/backtests.ts` pulls in
 * `next/cache` and instantiates a Prisma client.
 *
 * WHY EVERY NUMBER IS `.finite()`
 *
 * zod's `z.number()` rejects `NaN` but ACCEPTS `Infinity`. Without the
 * constraint, a posted `Infinity` passes validation, reaches
 * `toJournalTrade()`, and is stringified into a Decimal column as the literal
 * "Infinity" — which either fails at the driver with an opaque error or, worse,
 * lands and poisons every aggregate that later reads the row. Money columns
 * have no business accepting a non-finite value, so the guard belongs in the
 * schema rather than in each caller.
 */
export const simTradeSchema = z.object({
  side: z.enum(['LONG', 'SHORT']),
  lots: z.number().finite().positive(),
  entryTs: z.number().finite().int(),
  entryPrice: z.number().finite(),
  exitTs: z.number().finite().int(),
  exitPrice: z.number().finite(),
  exitReason: z.enum(['STOP_LOSS', 'TAKE_PROFIT', 'SIGNAL', 'END_OF_DATA']),
  stopLoss: z.number().finite().optional(),
  takeProfit: z.number().finite().optional(),
  netPnl: z.number().finite(),
  grossPnl: z.number().finite(),
  commission: z.number().finite(),
  pips: z.number().finite(),
  rMultiple: z.number().finite().nullable(),
  riskAmount: z.number().finite().nullable(),
  holdingMinutes: z.number().finite().nonnegative(),
  reason: z.string().max(200).optional(),
})

/**
 * Ceiling on trades written by one strategy run.
 *
 * The run itself is simulated in the browser now, so the server never sees
 * the bars — it sees only the resulting trades. That removes the CPU exposure
 * and replaces it with a write-volume one: without a cap, a client can post
 * ten million trade objects straight into a `createMany`. A 500k-bar run that
 * trades every 50 bars produces 10k trades, so this is generous for real
 * strategies and still bounds the insert.
 */
export const MAX_TRADES_PER_RUN = 10_000

/** Ceiling on log lines a run may report, mirroring the engine's own MAX_LOGS. */
export const MAX_RUN_LOGS = 500

/**
 * The full result the browser posts back after running a strategy.
 *
 * Note what is absent: any summary statistics. The server recomputes win
 * rate, expectancy, equity curve and drawdown from `trades` using the same
 * `summarize()`/`equityCurve()`/`maxDrawdown()` functions the rest of the app
 * uses. A client can therefore fabricate its own trades — see docs/BACKTEST.md
 * for why that is acceptable while every read path is user-scoped — but it
 * cannot post numbers that disagree with the trades they claim to summarise.
 */
export const simRunResultSchema = z.object({
  trades: z.array(simTradeSchema).max(MAX_TRADES_PER_RUN),
  barsProcessed: z.number().finite().int().nonnegative(),
  logs: z.array(z.string().max(500)).max(MAX_RUN_LOGS).default([]),
  error: z.string().max(2000).optional(),
})

export type SimRunResultInput = z.input<typeof simRunResultSchema>
