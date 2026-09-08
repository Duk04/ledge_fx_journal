/**
 * The fill model: turns a signal into a realistic execution price, and turns
 * a bar into a stop/target decision. This file is the single most important
 * one in the simulation engine, because a backtest doesn't lie by getting the
 * maths wrong — Decimal vs float errors are trivially caught — it lies by
 * assuming a *friendlier world* than the one a live account trades in. Every
 * assumption below is deliberately the pessimistic one. See
 * docs/BACKTEST-ENGINE.md for the write-up.
 *
 * PRICES ARE PLAIN NUMBERS, not Decimal (see types.ts for why).
 *
 * Convention used throughout: a `Bar`'s OHLC series is treated as the MID
 * price. Spread is applied symmetrically around it — half against the trader
 * on entry, half against the trader on exit — so a full round-trip pays the
 * full spread exactly once, however the trade's two legs land on different
 * bars. This mirrors how a broker who reports "mid" candles (common for
 * charting feeds that don't retain bid/ask) actually fills orders.
 */
import type { Bar, ExitReason, FillModel, Side, SimInstrument, SimPosition, SimTrade } from "./types";

/** Flip LONG <-> SHORT. Closing a position of one side crosses the spread the
 * same way opening the *opposite* side would (selling gets the bid, exactly
 * like buying the short side would) — see `exitAtMarket`. */
function opposite(side: Side): Side {
  return side === "LONG" ? "SHORT" : "LONG";
}

/** Convert a count of the instrument's smallest quoted increment (points,
 * 10^-digits) into an absolute price delta. */
export function pointsToPrice(instrument: SimInstrument, points: number): number {
  return points * instrument.pointSize;
}

/** Convert an absolute price delta into a count of points. Inverse of `pointsToPrice`. */
export function priceToPoints(instrument: SimInstrument, priceDelta: number): number {
  return priceDelta / instrument.pointSize;
}

/**
 * Signed pip move from `entryPrice` to `exitPrice`, positive when favourable
 * to `side`. Deliberately mirrors `computePips` in src/lib/metrics/trade.ts
 * exactly (same sign convention, same divide-by-pipSize shape) so a
 * simulated trade and a live journal trade agree — see fill.test.ts's
 * "agrees with computeTrade" case.
 */
export function pipsBetween(instrument: SimInstrument, entryPrice: number, exitPrice: number, side: Side): number {
  const rawDelta = exitPrice - entryPrice;
  const signedDelta = side === "LONG" ? rawDelta : -rawDelta;
  return signedDelta / instrument.pipSize;
}

/**
 * The price actually realized when crossing the spread to trade `side` at
 * `referencePrice` (the bar's mid), plus slippage — both applied AGAINST the
 * trader, because that is the one assumption that never flatters a backtest.
 * A long pays the ask (mid + half spread) and gets pushed further up by
 * slippage; a short receives the bid (mid - half spread) and gets pushed
 * further down. This one function is the building block behind
 * `entryPrice`, `exitAtMarket`, and the realized price inside `exitOnBar`.
 */
export function crossSpread(
  referencePrice: number,
  side: Side,
  fill: FillModel,
  instrument: SimInstrument,
  spreadPoints: number = fill.spreadPoints,
): number {
  const halfSpread = pointsToPrice(instrument, spreadPoints) / 2;
  const slippage = pointsToPrice(instrument, fill.slippagePoints);
  const sign = side === "LONG" ? 1 : -1;
  return referencePrice + sign * (halfSpread + slippage);
}

/**
 * Fill price for OPENING a position of `side` on `bar`. The caller is
 * responsible for passing the NEXT bar after the signal was generated — this
 * function has no notion of "which bar comes next" itself, and that is
 * deliberate: filling at the signal bar's own close/open is the single most
 * common way a backtest flatters itself (the strategy would be trading on a
 * price it could not have known was final). See runner.ts, which is the only
 * caller that decides bar timing.
 *
 * Uses the bar's own recorded spread when present, else the fill model's
 * default.
 */
export function entryPrice(bar: Bar, side: Side, fill: FillModel, instrument: SimInstrument): number {
  return crossSpread(bar.open, side, fill, instrument, bar.spread ?? fill.spreadPoints);
}

/**
 * Fill price for CLOSING a position of `positionSide` at market (a strategy's
 * `close()`, or the forced end-of-data close) — NOT for a stop/target, which
 * is `exitOnBar`'s job because those need gap handling.
 *
 * Closing a LONG means selling, which crosses the spread exactly like
 * *opening* a SHORT would (you receive the bid either way); closing a SHORT
 * means buying, exactly like opening a LONG. So this is `crossSpread` with
 * the side flipped — one fill model, no duplicated spread arithmetic.
 *
 * `referencePrice` is deliberately a plain number, not a `Bar`, because the
 * caller needs two different reference prices depending on why the trade is
 * closing: the NEXT bar's open for a strategy-requested close (same
 * no-lookahead rule as entryPrice), or the LAST bar's close for the
 * end-of-data close (there is no next bar). `spreadPoints` defaults to the
 * fill model's constant but callers should pass the relevant bar's own
 * `spread` when they have one, same as `entryPrice`.
 */
export function exitAtMarket(
  referencePrice: number,
  positionSide: Side,
  fill: FillModel,
  instrument: SimInstrument,
  spreadPoints: number = fill.spreadPoints,
): number {
  return crossSpread(referencePrice, opposite(positionSide), fill, instrument, spreadPoints);
}

/** Bid = mid - half spread (no slippage: slippage is a fill-time effect,
 * applied only once we know a level was actually touched — see exitOnBar). */
function bid(price: number, instrument: SimInstrument, spreadPoints: number): number {
  return price - pointsToPrice(instrument, spreadPoints) / 2;
}

/** Ask = mid + half spread. */
function ask(price: number, instrument: SimInstrument, spreadPoints: number): number {
  return price + pointsToPrice(instrument, spreadPoints) / 2;
}

/**
 * Decides whether `position`'s stop loss or take profit was hit within
 * `bar`, and at what price. Returns null if neither was touched.
 *
 * Three deliberate, documented lies this function refuses to tell:
 *
 * 1. SPREAD APPLIES ON EXIT TOO. A long position is closed by SELLING, i.e.
 *    at the bid, so its stop/target is checked against `bid(bar.high/low)`,
 *    not the raw bar prices. A short is closed by BUYING, at the ask. Using
 *    the raw mid price here would let a long's stop survive a bar that, once
 *    the spread is accounted for, actually took the bid through it —
 *    understating losses and overstating wins simultaneously.
 *
 * 2. A GAP THROUGH THE STOP FILLS AT THE BAR'S OPEN, not at the stop price.
 *    If the relevant side's OPEN (bid for a long, ask for a short) has
 *    already passed the level before the bar even starts trading, there was
 *    no liquidity at the stop price to fill against — that is exactly what a
 *    gap is. Pretending the fill happened at the clean stop price is the
 *    second most common way a backtest flatters itself. The same gap check
 *    is applied to the take-profit side too, for consistency, even though it
 *    is the friendlier direction to get wrong.
 *
 * 3. WHEN ONE BAR'S RANGE CONTAINS BOTH LEVELS, `fill.pessimisticFills`
 *    decides which "came first" inside the bar, since OHLC data alone cannot
 *    tell us the true intra-bar path. True (the default) assumes the worse
 *    outcome: the stop wins.
 *
 * Slippage is applied last, after the level/gap decision, and always against
 * the trader, on both stop and target fills — see FillModel.slippagePoints:
 * "Adverse price movement applied to every fill."
 */
export function exitOnBar(
  position: SimPosition,
  bar: Bar,
  fill: FillModel,
  instrument: SimInstrument,
): { price: number; reason: ExitReason } | null {
  const spreadPoints = bar.spread ?? fill.spreadPoints;
  const slippage = pointsToPrice(instrument, fill.slippagePoints);

  if (position.side === "LONG") {
    const openSide = bid(bar.open, instrument, spreadPoints);
    const highSide = bid(bar.high, instrument, spreadPoints);
    const lowSide = bid(bar.low, instrument, spreadPoints);

    const stopHit = position.stopLoss !== undefined && lowSide <= position.stopLoss;
    const targetHit = position.takeProfit !== undefined && highSide >= position.takeProfit;

    const reason = pickReason(stopHit, targetHit, fill.pessimisticFills);
    if (reason === null) return null;

    if (reason === "STOP_LOSS") {
      const level = position.stopLoss as number;
      const gapped = openSide <= level;
      return { price: (gapped ? openSide : level) - slippage, reason };
    }
    const level = position.takeProfit as number;
    const gapped = openSide >= level;
    return { price: (gapped ? openSide : level) - slippage, reason };
  }

  // SHORT: exits at the ask.
  const openSide = ask(bar.open, instrument, spreadPoints);
  const highSide = ask(bar.high, instrument, spreadPoints);
  const lowSide = ask(bar.low, instrument, spreadPoints);

  const stopHit = position.stopLoss !== undefined && highSide >= position.stopLoss;
  const targetHit = position.takeProfit !== undefined && lowSide <= position.takeProfit;

  const reason = pickReason(stopHit, targetHit, fill.pessimisticFills);
  if (reason === null) return null;

  if (reason === "STOP_LOSS") {
    const level = position.stopLoss as number;
    const gapped = openSide >= level;
    return { price: (gapped ? openSide : level) + slippage, reason };
  }
  const level = position.takeProfit as number;
  const gapped = openSide <= level;
  return { price: (gapped ? openSide : level) + slippage, reason };
}

/** Which of stop/target "wins" this bar. Both hit -> pessimisticFills decides. */
function pickReason(stopHit: boolean, targetHit: boolean, pessimisticFills: boolean): "STOP_LOSS" | "TAKE_PROFIT" | null {
  if (stopHit && targetHit) return pessimisticFills ? "STOP_LOSS" : "TAKE_PROFIT";
  if (stopHit) return "STOP_LOSS";
  if (targetHit) return "TAKE_PROFIT";
  return null;
}

/**
 * Turns a realized exit into a finished `SimTrade`. `price` is the price
 * ALREADY realized (from `exitOnBar`, `exitAtMarket`, or an END_OF_DATA
 * close) — this function does not itself cross the spread again.
 *
 * Mirrors src/lib/metrics/trade.ts exactly:
 *  - grossPnl = pips * pipValuePerLot * lots, pipValuePerLot = pipSize *
 *    contractSize * conversionRate (see pipValuePerLot() there).
 *  - commission is charged per lot PER SIDE, so a round trip pays it twice:
 *    2 * lots * commissionPerLot.
 *  - netPnl = grossPnl - commission (there is no swap concept in the sim).
 *  - riskAmount excludes commission, exactly like computeRiskAmount — it is
 *    the loss if price simply reaches the stop, comparable across cost
 *    structures. null when there is no stop.
 *  - rMultiple = netPnl / riskAmount, null when riskAmount is null OR zero
 *    (entry === stopLoss), same null semantics as computeRMultiple.
 */
export function closeAtPrice(
  position: SimPosition,
  price: number,
  ts: number,
  reason: ExitReason,
  fill: FillModel,
  instrument: SimInstrument,
): SimTrade {
  const pips = pipsBetween(instrument, position.entryPrice, price, position.side);
  const pipValuePerLot = instrument.pipSize * instrument.contractSize * fill.conversionRate;
  const grossPnl = pips * pipValuePerLot * position.lots;
  const commission = 2 * position.lots * fill.commissionPerLot;
  const netPnl = grossPnl - commission;

  let riskAmount: number | null = null;
  if (position.stopLoss !== undefined) {
    const riskPips = Math.abs(position.entryPrice - position.stopLoss) / instrument.pipSize;
    riskAmount = riskPips * pipValuePerLot * position.lots;
  }
  const rMultiple = riskAmount === null || riskAmount === 0 ? null : netPnl / riskAmount;

  const holdingMinutes = Math.round((ts - position.entryTs) / 60000);

  return {
    side: position.side,
    lots: position.lots,
    entryTs: position.entryTs,
    entryPrice: position.entryPrice,
    exitTs: ts,
    exitPrice: price,
    exitReason: reason,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    netPnl,
    grossPnl,
    commission,
    pips,
    rMultiple,
    riskAmount,
    holdingMinutes,
    reason: position.reason,
  };
}
