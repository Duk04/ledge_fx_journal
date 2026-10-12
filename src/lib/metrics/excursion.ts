/**
 * MAE / MFE — maximum adverse and favourable excursion: the worst and the best
 * price a position saw while it was open. Together with the realised R they
 * answer the two questions a stop and a target are guesses about: "how far do
 * my winners go against me first?" (stop placement) and "how much of the move
 * did I keep?" (exit efficiency).
 *
 * From candles: only bars wholly INSIDE the holding period are read. The bar
 * containing the entry also holds prices from before the fill, and the bar
 * containing the exit holds prices from after it; reading either would
 * invent excursion the position never had. The entry and exit prices
 * themselves stand in for those edges. M1 bars only — on anything coarser
 * the edge bars are most of the trade.
 */
import { Decimal } from "decimal.js";

export interface ExcursionBar {
  /** Bar OPEN time. */
  ts: Date;
  high: Decimal.Value;
  low: Decimal.Value;
}

export interface Excursion {
  /** Worst price against the position. */
  maePrice: Decimal;
  /** Best price in the position's favour. */
  mfePrice: Decimal;
  /** Bars inside the holding period that were read. */
  barsUsed: number;
}

const MINUTE = 60_000;

/**
 * null when the candles don't cover the trade: none inside the holding
 * period although it lasted more than two minutes, or a gap of more than
 * five minutes at either end (missing data reads as "no excursion", which
 * would be a confident wrong answer).
 */
export function excursionFromBars(
  trade: {
    direction: "LONG" | "SHORT";
    entryPrice: Decimal.Value;
    exitPrice: Decimal.Value;
    openedAt: Date;
    closedAt: Date;
  },
  bars: readonly ExcursionBar[],
): Excursion | null {
  const firstFull = Math.floor(trade.openedAt.getTime() / MINUTE) * MINUTE + MINUTE;
  const lastFull = Math.floor(trade.closedAt.getTime() / MINUTE) * MINUTE - MINUTE;
  const inside = bars.filter((b) => b.ts.getTime() >= firstFull && b.ts.getTime() <= lastFull);

  if (lastFull >= firstFull) {
    if (inside.length === 0) return null;
    const first = Math.min(...inside.map((b) => b.ts.getTime()));
    const last = Math.max(...inside.map((b) => b.ts.getTime()));
    if (first - firstFull > 5 * MINUTE || lastFull - last > 5 * MINUTE) return null;
  }

  const prices = [new Decimal(trade.entryPrice), new Decimal(trade.exitPrice)];
  const highs = [...prices, ...inside.map((b) => new Decimal(b.high))];
  const lows = [...prices, ...inside.map((b) => new Decimal(b.low))];
  const high = Decimal.max(...highs);
  const low = Decimal.min(...lows);

  return trade.direction === "LONG"
    ? { maePrice: low, mfePrice: high, barsUsed: inside.length }
    : { maePrice: high, mfePrice: low, barsUsed: inside.length };
}

/**
 * Excursions in R against the stop the trade was opened with. MAE is ≤ 0
 * (how far against), MFE ≥ 0 (how far in favour). null without a stop.
 */
export function excursionInR(trade: {
  direction: "LONG" | "SHORT";
  entryPrice: Decimal.Value;
  riskStop: Decimal.Value | null;
  maePrice: Decimal.Value | null;
  mfePrice: Decimal.Value | null;
}): { maeR: Decimal | null; mfeR: Decimal | null } {
  if (trade.riskStop === null) return { maeR: null, mfeR: null };
  const entry = new Decimal(trade.entryPrice);
  const risk = entry.minus(trade.riskStop).abs();
  if (risk.isZero()) return { maeR: null, mfeR: null };
  const sign = trade.direction === "LONG" ? 1 : -1;
  const r = (p: Decimal.Value | null) => (p === null ? null : new Decimal(p).minus(entry).times(sign).div(risk));
  const mae = r(trade.maePrice);
  const mfe = r(trade.mfePrice);
  return { maeR: mae && Decimal.min(mae, 0), mfeR: mfe && Decimal.max(mfe, 0) };
}
