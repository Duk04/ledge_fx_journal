import "server-only";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/db";
import { fail } from "../result";
import { classifyOutcome } from "@/lib/metrics";
import type { TradeRow } from "@/lib/metrics/types";
import type { SimTrade } from "@/lib/backtest/types";

/**
 * Constants, schemas and sync helpers shared by the replay and strategy
 * actions.
 *
 * NOTE THE ABSENCE OF `"use server"`. Next requires every export of a
 * `"use server"` module to be an async function it can assign an action id
 * to — a constant, a type or a sync helper there is a build error. So a
 * module of shared non-action code has to be a plain module, and
 * `import "server-only"` is what keeps it off the client instead.
 */

export const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;

/** Fewer bars than this can't tell you anything about a strategy or a
 * replay session — refuse rather than run something meaningless. */
export const MIN_BARS = 50;
/**
 * Independent of (and tighter than) the engine's own `HARD_BAR_CAP`
 * (1,000,000 — see runner.ts): that cap exists to bound a pathological
 * strategy's runtime once a run is already underway, this one exists so a
 * server action never even starts a run big enough to tie up the request
 * for an unreasonable time. Refusing up front with a clear message beats
 * either silently truncating the requested range or letting the request
 * hang.
 */
export const MAX_BARS = 500_000;

/** A strategy parameter's value: a number, a string or a flag. */
export const paramValue = z.union([z.number(), z.string(), z.boolean()]);

export const fillSchema = z.object({
  spreadPoints: z.coerce.number().int().min(0).max(100_000),
  commissionPerLot: z.coerce.number().min(0).max(100_000),
  slippagePoints: z.coerce.number().int().min(0).max(100_000),
  pessimisticFills: z.boolean().default(true),
});

/** Backtest accounts are always opened in USD — see docs/BACKTEST.md's
 * design-decision section. Nothing in the run/replay forms asks for a
 * currency, so there is nowhere else this could come from. */

/**
 * The error arm is typed `ActionFailure`, not `ActionResult`. `ActionResult`
 * includes the success arm, so returning one from a function declared
 * `Promise<ActionResult<{ runId: string }>>` does not typecheck — the payload
 * would be missing. `ActionFailure` is assignable to every `ActionResult<T>`,
 * which is what a shared failure value needs to be.
 */
export async function loadInstrumentOrError(symbol: string) {
  const instrument = await prisma.instrument.findUnique({ where: { symbol } });
  if (!instrument) {
    return { error: fail(`"${symbol}" is not a known instrument.`) };
  }
  return { instrument };
}

export function labelFor(kind: "Replay" | "Strategy" | string, symbol: string, timeframe: string, from: Date): string {
  const dateLabel = from.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  return `${kind} · ${symbol} ${timeframe} · ${dateLabel}`;
}

/** Converts a finished `SimTrade` array straight into `TradeRow`s for
 * `summarize()`/`equityCurve()`, without a DB round-trip — the run's own
 * numbers should reflect exactly what the simulation produced. */
export function simTradesToRows(trades: SimTrade[]): TradeRow[] {
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
