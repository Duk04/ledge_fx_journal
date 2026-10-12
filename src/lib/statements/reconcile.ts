/**
 * Our P&L vs the broker's, and what conversion rate to store.
 *
 * The broker's Profit column is the ground truth for what a closed position
 * paid, in the account currency, gross of commission and swap. That makes it
 * the best source for the one number this journal cannot otherwise know: the
 * quote->account conversion rate for a cross (EURJPY in a USD account), which
 * lib/conversion.ts would otherwise ASSUME as 1 and flag. So:
 *
 *   implied rate = brokerProfit / (direction · (exit − entry) · contractSize · lots)
 *
 * - Cross (conversion would be ASSUMED_ONE): store the implied rate as an
 *   explicit rate. The trade is then exact, with nothing to fix by hand.
 * - Quote = account, or account = base (IDENTITY / INVERSE_PRICE): the rate
 *   is already known. Store nothing; just check our gross against the broker.
 *   A mismatch there is NOT papered over with an implied rate — it almost
 *   always means the instrument spec is wrong for this broker (an index CFD
 *   with a different contract size), and that has to be visible.
 *
 * Tolerance: half a percent of the broker figure, at least 2 cents. Brokers
 * round per deal and some convert at a slightly different rate than the
 * close price; anything inside that is noise, anything outside is a finding.
 */
import { Decimal } from "decimal.js";
import { resolveConversion, type ConversionSource } from "@/lib/conversion";
import type { ParsedPosition } from "./types";

export interface InstrumentForReconcile {
  symbol: string;
  baseCurrency: string | null;
  quoteCurrency: string;
  contractSize: string;
}

export interface Reconciliation {
  /** What to write to Trade.conversionRate: an implied rate, or null to let
   * lib/conversion.ts decide as it would for a hand-entered trade. */
  conversionRate: string | null;
  source: ConversionSource | "IMPLIED";
  /** Our gross P&L in account currency, with the rate we will store. */
  grossPnl: string | null;
  brokerProfit: string | null;
  /** True when our gross and the broker's disagree beyond the tolerance. */
  mismatch: boolean;
  /** True when the rate is still a 1:1 guess the user should fix. */
  needsAttention: boolean;
}

export function reconcile(
  position: ParsedPosition,
  instrument: InstrumentForReconcile,
  accountCurrency: string,
): Reconciliation {
  const reference = position.exitPrice ?? position.entryPrice;
  const standard = resolveConversion({ instrument, accountCurrency, referencePrice: reference });
  const broker = position.brokerProfit;

  const priceMove =
    position.exitPrice === null
      ? null
      : new Decimal(position.exitPrice).minus(position.entryPrice).times(position.direction === "LONG" ? 1 : -1);
  const notional = priceMove?.times(instrument.contractSize).times(position.volumeLots) ?? null;

  if (notional === null || broker === null) {
    return {
      conversionRate: null,
      source: standard.source,
      grossPnl: notional ? notional.times(standard.rate).toDecimalPlaces(2).toString() : null,
      brokerProfit: broker,
      mismatch: false,
      needsAttention: standard.needsAttention,
    };
  }

  const brokerDec = new Decimal(broker);
  const tolerance = Decimal.max(new Decimal("0.02"), brokerDec.abs().times("0.005"));

  if (standard.needsAttention && !notional.isZero()) {
    const implied = brokerDec.div(notional);
    if (implied.gt(0)) {
      return {
        conversionRate: implied.toSignificantDigits(10).toString(),
        source: "IMPLIED",
        grossPnl: brokerDec.toDecimalPlaces(2).toString(),
        brokerProfit: broker,
        mismatch: false,
        needsAttention: false,
      };
    }
  }

  const ours = notional.times(standard.rate).toDecimalPlaces(2);
  return {
    conversionRate: null,
    source: standard.source,
    grossPnl: ours.toString(),
    brokerProfit: broker,
    mismatch: ours.minus(brokerDec).abs().gt(tolerance),
    needsAttention: standard.needsAttention,
  };
}
