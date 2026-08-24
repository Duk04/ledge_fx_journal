import { Decimal } from "decimal.js";
import type { Instrument } from "@prisma/client";

/**
 * Quote-currency conversion.
 *
 * A pip's value is denominated in the instrument's QUOTE currency, but the
 * account is denominated in the account's currency. For EURUSD in a USD account
 * those are the same and nobody notices. For USDJPY they are not, and if the
 * app quietly assumes a rate of 1 it reports a $12,000 loss on a trade that
 * actually lost $85 — a bug bad enough to make the whole journal worthless,
 * which is exactly what happened in this project's first data backfill.
 *
 * So the rule is: the rate is either KNOWN or the trade is FLAGGED. It is never
 * silently assumed.
 */

export type ConversionSource =
  /** Quote currency is already the account currency — the rate is exactly 1. */
  | "IDENTITY"
  /**
   * The account currency is the instrument's BASE currency (e.g. a USD account
   * trading USDJPY), so one unit of quote currency is worth 1/price of the
   * account currency. The trade's own price is the rate — no external data
   * needed, and it is the rate that applied at the time, which is what a
   * journal wants.
   */
  | "INVERSE_PRICE"
  /** The user supplied the rate explicitly. Always wins. */
  | "EXPLICIT"
  /**
   * Neither of the above applies (e.g. a USD account trading EURJPY). We fall
   * back to 1 so statistics still compute, but the trade is flagged so the UI
   * can ask for the real rate instead of pretending.
   */
  | "ASSUMED_ONE";

export type ConversionResult = {
  rate: Decimal;
  source: ConversionSource;
  /** True when the number is a guess the user should replace. */
  needsAttention: boolean;
};

/** Best-effort base currency for an instrument, for the 6-letter FX case. */
export function baseCurrencyOf(instrument: Pick<Instrument, "symbol" | "baseCurrency">): string | null {
  if (instrument.baseCurrency) return instrument.baseCurrency;
  const s = instrument.symbol.toUpperCase();
  return /^[A-Z]{6}$/.test(s) ? s.slice(0, 3) : null;
}

export function resolveConversion({
  instrument,
  accountCurrency,
  explicitRate,
  referencePrice,
}: {
  instrument: Pick<Instrument, "symbol" | "baseCurrency" | "quoteCurrency">;
  accountCurrency: string;
  /** Whatever the user stored on the trade, if anything. */
  explicitRate?: Decimal | string | number | null;
  /** Price to invert for the INVERSE_PRICE case — use the exit price when the
   *  trade is closed (that is the rate that realised the P&L), else the entry. */
  referencePrice?: Decimal | string | number | null;
}): ConversionResult {
  if (explicitRate !== null && explicitRate !== undefined && explicitRate !== "") {
    const rate = new Decimal(explicitRate.toString());
    if (rate.gt(0)) return { rate, source: "EXPLICIT", needsAttention: false };
  }

  const quote = instrument.quoteCurrency.toUpperCase();
  const account = accountCurrency.toUpperCase();
  if (quote === account) {
    return { rate: new Decimal(1), source: "IDENTITY", needsAttention: false };
  }

  const base = baseCurrencyOf(instrument);
  if (base && base.toUpperCase() === account && referencePrice) {
    const price = new Decimal(referencePrice.toString());
    if (price.gt(0)) {
      return { rate: new Decimal(1).div(price), source: "INVERSE_PRICE", needsAttention: false };
    }
  }

  return { rate: new Decimal(1), source: "ASSUMED_ONE", needsAttention: true };
}

/** Human-readable explanation for the UI. */
export function conversionNote(result: ConversionResult, instrument: { quoteCurrency: string }, accountCurrency: string) {
  switch (result.source) {
    case "IDENTITY":
      return null;
    case "EXPLICIT":
      return `Using the conversion rate you entered (${result.rate.toDecimalPlaces(6)}).`;
    case "INVERSE_PRICE":
      return `${instrument.quoteCurrency} converted to ${accountCurrency} at 1/price (${result.rate.toDecimalPlaces(6)}), the rate in effect for this trade.`;
    case "ASSUMED_ONE":
      return `This instrument is quoted in ${instrument.quoteCurrency} but the account is in ${accountCurrency}, and the rate can't be derived from the price. P&L is shown at 1:1 — enter a conversion rate to make it accurate.`;
  }
}
