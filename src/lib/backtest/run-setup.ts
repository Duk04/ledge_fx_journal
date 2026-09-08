import "server-only";
import type { Prisma } from "@prisma/client";
import { resolveConversion } from "@/lib/conversion";
import type { SimInstrument } from "@/lib/backtest/types";

/**
 * Turning a stored `Instrument` row into the engine's `SimInstrument`, and
 * picking a run's conversion rate.
 *
 * Both used to live inside `src/lib/actions/backtests.ts`, next to their only
 * caller. They moved here when strategy runs moved into the browser: the
 * `/api/backtest/bars` route handler now has to produce the same values, and
 * they cannot be imported from a `"use server"` module (every export of one
 * must be an async function Next can assign an action id to — a plain helper
 * or a constant is a build error there).
 *
 * `import "server-only"` keeps this out of a client bundle: it reads Prisma
 * decimals and the conversion table, and the *values* it produces are what
 * cross to the browser, not the code that derives them.
 */

/** Backtest accounts are always denominated in USD. */
export const BACKTEST_ACCOUNT_CURRENCY = "USD";

export function toSimInstrument(instrument: {
  symbol: string;
  digits: number;
  pipSize: Prisma.Decimal;
  contractSize: Prisma.Decimal;
  quoteCurrency: string;
}): SimInstrument {
  return {
    symbol: instrument.symbol,
    digits: instrument.digits,
    pipSize: Number(instrument.pipSize),
    contractSize: Number(instrument.contractSize),
    quoteCurrency: instrument.quoteCurrency,
    pointSize: 10 ** -instrument.digits,
  };
}

/**
 * One fixed conversion rate for the whole run. The live journal resolves this
 * per trade (see trade-service.ts's `tradeConversion`, using each trade's own
 * exit price), but a backtest fill model (`FillModel.conversionRate`) is a
 * single constant applied to every trade in the run — there is no per-trade
 * slot for it. Using the LAST bar's close as the reference price is the
 * closest single-number equivalent: it is the rate that would have applied to
 * a trade closed near the end of the tested range, which is as reasonable a
 * fixed stand-in as any one number can be for a rate that, in reality,
 * drifted throughout the range.
 *
 * Derived on the server in both places that need it — the bars endpoint, so
 * the browser's simulation uses it, and again in `recordStrategyRun`, so the
 * rate stored on the run is the server's rather than the client's.
 */
export function resolveRunConversionRate(
  instrument: { symbol: string; baseCurrency: string | null; quoteCurrency: string },
  lastClose: number,
): number {
  return resolveConversion({
    instrument,
    accountCurrency: BACKTEST_ACCOUNT_CURRENCY,
    referencePrice: lastClose,
  }).rate.toNumber();
}
