/**
 * Per-trade calculations. Every function here is pure and takes a `TradeInput`
 * (or plain values) — no I/O, no database, no framework dependency.
 *
 * MONEY RULE: all arithmetic is done with `Decimal` (see decimal.ts `d()`).
 * Functions return `Decimal` (or `Decimal | null`); conversion to plain JS
 * numbers happens only in formatters.ts at the presentation boundary.
 */
import { Decimal } from 'decimal.js'
import { d, BREAKEVEN_EPSILON } from './decimal'
import type {
  DecimalInput,
  InstrumentSpec,
  Outcome,
  TradeGeometryProblem,
  TradeInput,
  TradeResult,
} from './types'

/**
 * Value, in ACCOUNT currency, of a one-pip move on 1.0 lot of `instrument`.
 *
 *   pipValuePerLot = pipSize * contractSize * conversionRate
 *
 * `conversionRate` converts 1 unit of the instrument's quote currency into
 * the account currency and defaults to 1 (quote currency == account
 * currency, e.g. a USD account trading EURUSD). For a cross where the quote
 * currency differs from the account currency (e.g. a USD account trading
 * USDJPY, quoted in JPY) pass conversionRate = 1 / (USDJPY rate), i.e. the
 * JPY->USD rate, so the result comes out in USD.
 */
export function pipValuePerLot(instrument: InstrumentSpec, conversionRate: DecimalInput = 1): Decimal {
  return d(instrument.pipSize).times(d(instrument.contractSize)).times(d(conversionRate))
}

/** Convert a raw price delta into a pip count for `instrument` (unsigned — sign follows the input delta). */
export function priceDeltaToPips(instrument: InstrumentSpec, delta: DecimalInput): Decimal {
  return d(delta).div(d(instrument.pipSize))
}

/**
 * Signed pip move for a trade, positive when favourable to its direction.
 * null while the trade is open (no exitPrice yet).
 */
export function computePips(trade: TradeInput): Decimal | null {
  if (trade.exitPrice === undefined) return null
  const rawDelta = d(trade.exitPrice).minus(d(trade.entryPrice))
  const signedDelta = trade.direction === 'LONG' ? rawDelta : rawDelta.negated()
  return priceDeltaToPips(trade.instrument, signedDelta)
}

/** pips * pipValuePerLot * volumeLots. null while open. */
export function computeGrossPnl(trade: TradeInput): Decimal | null {
  const pips = computePips(trade)
  if (pips === null) return null
  const pipValue = pipValuePerLot(trade.instrument, trade.conversionRate)
  return pips.times(pipValue).times(d(trade.volumeLots))
}

/**
 * grossPnl - commission - swap.
 *
 * Sign convention: `commission` and `swap` are POSITIVE numbers representing
 * a cost to the trader (the normal case), so they are subtracted from gross
 * P&L. A rebate or swap credit is simply passed as a NEGATIVE number —
 * subtracting a negative algebraically adds it back to netPnl. There is no
 * separate "credit" field; the sign of the value already tells the whole
 * story.
 */
export function computeNetPnl(trade: TradeInput): Decimal | null {
  const gross = computeGrossPnl(trade)
  if (gross === null) return null
  const commission = d(trade.commission ?? 0)
  const swap = d(trade.swap ?? 0)
  return gross.minus(commission).minus(swap)
}

/**
 * Pure price risk implied by the stop loss, in account currency:
 *
 *   riskPips = |entry - stopLoss| / pipSize
 *   riskAmount = riskPips * pipValuePerLot * volumeLots
 *
 * Deliberately excludes commission/swap: risk is defined as the loss if
 * price simply reaches the stop, which is what the trader actually planned
 * against and is comparable across brokers/instruments with very different
 * fee structures. Folding in commission would make R multiples depend on
 * incidental costs rather than the trade's planned risk. null if no stop
 * loss is set.
 */
export function computeRiskAmount(trade: TradeInput): Decimal | null {
  if (trade.stopLoss === undefined) return null
  const riskPips = d(trade.entryPrice).minus(d(trade.stopLoss)).abs().div(d(trade.instrument.pipSize))
  const pipValue = pipValuePerLot(trade.instrument, trade.conversionRate)
  return riskPips.times(pipValue).times(d(trade.volumeLots))
}

/** netPnl / riskAmount. null when either is unavailable, or riskAmount is zero (would be a division by zero). */
export function computeRMultiple(trade: TradeInput): Decimal | null {
  const net = computeNetPnl(trade)
  const risk = computeRiskAmount(trade)
  if (net === null || risk === null || risk.isZero()) return null
  return net.div(risk)
}

/**
 * Planned reward:risk ratio, decided before entry:
 *
 *   plannedRR = |takeProfit - entry| / |stopLoss - entry|
 *
 * null if either leg is missing, if the stop-loss distance is zero (division
 * by zero), or if the trade's geometry is invalid — e.g. a long with its
 * stop above entry. See validateTradeGeometry for the exact rules; a
 * geometrically broken plan has no meaningful reward:risk number.
 */
export function computePlannedRR(trade: TradeInput): Decimal | null {
  if (trade.stopLoss === undefined || trade.takeProfit === undefined) return null
  const entry = d(trade.entryPrice)
  const sl = d(trade.stopLoss)
  const tp = d(trade.takeProfit)
  const riskDelta = entry.minus(sl).abs()
  if (riskDelta.isZero()) return null
  const problems = validateTradeGeometry(trade)
  const hasGeometryProblem = problems.some((p) => p.code === 'SL_WRONG_SIDE' || p.code === 'TP_WRONG_SIDE')
  if (hasGeometryProblem) return null
  const rewardDelta = tp.minus(entry).abs()
  return rewardDelta.div(riskDelta)
}

/**
 * Sanity-checks a trade's price geometry and returns every problem found
 * (empty array if none). Does not throw — callers decide what to do with
 * problems (e.g. block save, or just null-out plannedRR).
 *
 * Rules (a stop/target exactly AT entry is treated as invalid too — it
 * implies zero risk or zero reward, which is not a usable plan):
 *  - SL_WRONG_SIDE: long stop loss >= entry, or short stop loss <= entry.
 *  - TP_WRONG_SIDE: long take profit <= entry, or short take profit >= entry.
 *  - ZERO_OR_NEGATIVE_VOLUME: volumeLots <= 0.
 *  - CLOSED_BEFORE_OPENED: closedAt earlier than openedAt.
 */
export function validateTradeGeometry(trade: TradeInput): TradeGeometryProblem[] {
  const problems: TradeGeometryProblem[] = []
  const entry = d(trade.entryPrice)

  if (trade.stopLoss !== undefined) {
    const sl = d(trade.stopLoss)
    if (trade.direction === 'LONG' && sl.gte(entry)) {
      problems.push({ code: 'SL_WRONG_SIDE', message: 'Long stop loss must be below entry price.' })
    }
    if (trade.direction === 'SHORT' && sl.lte(entry)) {
      problems.push({ code: 'SL_WRONG_SIDE', message: 'Short stop loss must be above entry price.' })
    }
  }

  if (trade.takeProfit !== undefined) {
    const tp = d(trade.takeProfit)
    if (trade.direction === 'LONG' && tp.lte(entry)) {
      problems.push({ code: 'TP_WRONG_SIDE', message: 'Long take profit must be above entry price.' })
    }
    if (trade.direction === 'SHORT' && tp.gte(entry)) {
      problems.push({ code: 'TP_WRONG_SIDE', message: 'Short take profit must be below entry price.' })
    }
  }

  if (d(trade.volumeLots).lte(0)) {
    problems.push({ code: 'ZERO_OR_NEGATIVE_VOLUME', message: 'Volume must be greater than zero.' })
  }

  if (trade.closedAt !== undefined && trade.closedAt.getTime() < trade.openedAt.getTime()) {
    problems.push({ code: 'CLOSED_BEFORE_OPENED', message: 'closedAt must not be before openedAt.' })
  }

  return problems
}

/** Whole minutes between openedAt and closedAt, rounded to the nearest minute. null while open. */
export function computeHoldingMinutes(trade: TradeInput): number | null {
  if (trade.closedAt === undefined) return null
  const ms = trade.closedAt.getTime() - trade.openedAt.getTime()
  return Math.round(ms / 60000)
}

/**
 * Classifies a trade's outcome. `status` is 'OPEN' when the trade has no
 * exit yet (regardless of netPnl, which will be null in that case).
 * A |netPnl| below BREAKEVEN_EPSILON (0.005 account-currency units) is
 * treated as BREAKEVEN rather than a true win/loss, to absorb sub-cent
 * rounding noise.
 */
export function classifyOutcome(netPnl: Decimal | null, status: 'OPEN' | 'CLOSED'): Outcome {
  if (status === 'OPEN' || netPnl === null) return 'OPEN'
  if (netPnl.abs().lt(BREAKEVEN_EPSILON)) return 'BREAKEVEN'
  return netPnl.isPositive() ? 'WIN' : 'LOSS'
}

/**
 * The single entry point: computes every derived metric for one trade. Used
 * both by the API on save and by a backfill script re-deriving historical
 * trades.
 */
export function computeTrade(trade: TradeInput): TradeResult {
  const pips = computePips(trade)
  const pipValue = pipValuePerLot(trade.instrument, trade.conversionRate)
  const grossPnl = computeGrossPnl(trade)
  const netPnl = computeNetPnl(trade)
  const riskAmount = computeRiskAmount(trade)
  const rMultiple = computeRMultiple(trade)
  const plannedRR = computePlannedRR(trade)
  const holdingMinutes = computeHoldingMinutes(trade)
  const status: 'OPEN' | 'CLOSED' = trade.exitPrice === undefined ? 'OPEN' : 'CLOSED'
  const outcome = classifyOutcome(netPnl, status)

  return {
    pips,
    pipValuePerLot: pipValue,
    grossPnl,
    netPnl,
    riskAmount,
    rMultiple,
    plannedRR,
    holdingMinutes,
    outcome,
  }
}
