import { Decimal } from "decimal.js";
import { positionSize } from "@/lib/simulate/position-size";
import type { SimInstrument } from "./types";

/**
 * The pure half of the replay chart's tools: drawings and the position tool.
 * The canvas half is components/backtest/replay/drawings-primitive.ts.
 *
 * ANCHORS ARE BAR INDEXES, NOT TIMES. A drawing point is (index into the
 * session's full bar array, price). The chart can place an index anywhere,
 * including the empty space to the right of the last visible bar, where a
 * trader extends a line into the future. A timestamp there has no
 * coordinate. The index also stays put when the replay steps back, because
 * the session's bar array never changes, only how much of it is shown.
 */

export type DrawingKind = "trend" | "hline" | "rect" | "fib";

export interface Anchor {
  /** Index into the session's bars (may lie beyond the visible cursor). */
  i: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  a: Anchor;
  /** Absent for a horizontal line, which is one price everywhere. */
  b?: Anchor;
}

/** How many clicks a tool takes. */
export function pointsFor(kind: DrawingKind): 1 | 2 {
  return kind === "hline" ? 1 : 2;
}

/** The standard retracement set. 0 is the second click (where price went),
 * 1 the first (where it came from), so a level reads as "how much of the
 * move has been given back". */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export function fibLevels(a: Anchor, b: Anchor): { level: number; price: number }[] {
  return FIB_LEVELS.map((level) => ({ level, price: b.price + (a.price - b.price) * level }));
}

export interface PositionToolInput {
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target: number;
}

export interface PositionToolStats {
  /** False when the stop or target is on the wrong side of the entry; the
   * chart draws it anyway, in a warning colour, and orders stay disabled. */
  valid: boolean;
  stopPips: number;
  targetPips: number;
  /** Reward over risk. */
  rr: number | null;
  /** Lots for the risk budget, rounded DOWN to 0.01, so it never risks more
   * than asked. Null when the stop distance is zero. */
  lots: number | null;
  riskAmount: number | null;
  rewardAmount: number | null;
}

export function positionToolStats(
  tool: PositionToolInput,
  ctx: { instrument: SimInstrument; balance: number; riskPct: number; conversionRate: number },
): PositionToolStats {
  const { entry, stop, target, side } = tool;
  const valid = side === "LONG" ? stop < entry && target > entry : stop > entry && target < entry;
  const stopPips = Math.abs(entry - stop) / ctx.instrument.pipSize;
  const targetPips = Math.abs(target - entry) / ctx.instrument.pipSize;
  const sized = positionSize({
    instrument: ctx.instrument,
    balance: ctx.balance,
    riskPct: ctx.riskPct,
    entry,
    stop,
    conversionRate: ctx.conversionRate,
  });
  const lots = sized && sized.lots.gt(0) ? sized.lots.toNumber() : null;
  const perPipPerLot = new Decimal(ctx.instrument.pipSize).times(ctx.instrument.contractSize).times(ctx.conversionRate);
  const rewardAmount = lots === null ? null : perPipPerLot.times(targetPips).times(lots).toNumber();
  return {
    valid,
    stopPips,
    targetPips,
    rr: stopPips > 0 ? targetPips / stopPips : null,
    lots,
    riskAmount: lots === null || !sized ? null : sized.riskAmount.toNumber(),
    rewardAmount,
  };
}

/** A fresh position tool at `entry`: stop and target placed `stopPips`
 * away at 1:2, the shape most setups start from before being dragged. */
export function defaultPositionTool(
  side: "LONG" | "SHORT",
  entry: number,
  instrument: SimInstrument,
  stopPips = 20,
): PositionToolInput {
  const d = stopPips * instrument.pipSize;
  const dir = side === "LONG" ? 1 : -1;
  return { side, entry, stop: entry - dir * d, target: entry + dir * 2 * d };
}
