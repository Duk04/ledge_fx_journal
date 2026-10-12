/**
 * Position size from a risk budget: how many lots risk exactly X% (or an
 * amount) if price reaches the stop. Decimal arithmetic through the same
 * pip-value formula the journal uses (lib/metrics/trade.ts), so the size it
 * suggests is the size whose recorded risk will equal the budget.
 *
 *   lots = budget / (|entry − stop| / pipSize × pipValuePerLot)
 *
 * Rounded DOWN to the lot step: rounding up would risk more than asked.
 */
import { Decimal } from "decimal.js";
import { pipValuePerLot } from "@/lib/metrics/trade";
import type { InstrumentSpec } from "@/lib/metrics/types";

export interface PositionSizeInput {
  instrument: InstrumentSpec;
  balance: Decimal.Value;
  riskPct: Decimal.Value;
  entry: Decimal.Value;
  stop: Decimal.Value;
  /** Quote -> account currency (lib/conversion.ts). */
  conversionRate: Decimal.Value;
  lotStep?: Decimal.Value;
}

export interface PositionSize {
  lots: Decimal;
  stopPips: Decimal;
  /** What `lots` actually risks, after rounding down. */
  riskAmount: Decimal;
  budget: Decimal;
}

export function positionSize(input: PositionSizeInput): PositionSize | null {
  const distance = new Decimal(input.entry).minus(input.stop).abs();
  if (distance.isZero()) return null;
  const stopPips = distance.div(input.instrument.pipSize);
  const perLot = stopPips.times(pipValuePerLot(input.instrument, new Decimal(input.conversionRate)));
  if (perLot.lte(0)) return null;
  const budget = new Decimal(input.balance).times(input.riskPct).div(100);
  const step = new Decimal(input.lotStep ?? "0.01");
  const lots = budget.div(perLot).div(step).floor().times(step);
  return { lots, stopPips, riskAmount: lots.times(perLot), budget };
}
