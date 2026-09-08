/**
 * Small shared Decimal utilities used throughout the metrics module.
 *
 * MONEY RULE: every price/money/volume computation in src/lib/metrics uses
 * decimal.js `Decimal`, never native JS numbers. `d()` is the single
 * normalisation point: every public function accepts `Decimal | string | number`
 * and immediately funnels inputs through `d()` before doing arithmetic. This
 * avoids binary floating point drift (e.g. 1.0850 - 1.0849 !== 0.0001 in
 * native JS numbers) which would otherwise corrupt pip/PnL/R calculations.
 *
 * Only at the presentation boundary (formatters.ts) do we call `.toNumber()`
 * or `.toFixed()` to hand a plain string/number to the UI.
 */
import { Decimal } from 'decimal.js'
import type { DecimalInput } from './types'

/** Normalise a Decimal | string | number into a Decimal. The one entry point for money math. */
export function d(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value
  return new Decimal(value)
}

/** Convenience zero constant. */
export const ZERO = new Decimal(0)

/**
 * Money amounts within this absolute threshold of zero are treated as
 * "breakeven" rather than a true win/loss, absorbing sub-cent rounding noise
 * from broker fills, commission and swap. See classifyOutcome in trade.ts.
 */
export const BREAKEVEN_EPSILON = new Decimal('0.005')

/**
 * The same threshold as a string, for Prisma `where` comparisons.
 *
 * Prisma's Decimal filters accept `string | number | Prisma.Decimal`, and a
 * decimal.js `Decimal` is none of those — so the query layer needs this
 * encoding. It is derived rather than retyped: the value existed as a literal
 * in three places (here, queries/trades.ts and trade-service.ts), each with a
 * comment promising it matched the others.
 */
export const BREAKEVEN_EPSILON_STR = BREAKEVEN_EPSILON.toString()
