import type { Instrument, Prisma, Trade } from "@prisma/client";
import { Decimal } from "decimal.js";
import { computeAnyTrade, marketSession, classifyOutcome } from "@/lib/metrics";
import type { AnyTradeInput, InstrumentSpec, RTradeInput, TradeInput, TradeRow } from "@/lib/metrics/types";
import { fromDec, toDec, toDecOr } from "@/lib/decimal-bridge";
import { resolveConversion } from "@/lib/conversion";

/**
 * The single place where a trade's derived numbers are produced.
 *
 * The derived columns (netPnl, pips, rMultiple, riskAmount, holdingMinutes,
 * marketSession) are stored on the row rather than computed on read, because
 * every list, filter and report in the app sorts and aggregates on them and
 * recomputing 5,000 rows per page view is indefensible. The cost of that
 * decision is that the columns can go stale when a formula changes — which is
 * why they are ONLY ever written by this function, and why
 * `scripts/backfill-metrics.ts` exists to recompute the whole table.
 */

export function instrumentSpec(instrument: Instrument): InstrumentSpec {
  return {
    symbol: instrument.symbol,
    pipSize: instrument.pipSize.toString(),
    contractSize: instrument.contractSize.toString(),
    digits: instrument.digits,
    quoteCurrency: instrument.quoteCurrency,
    assetClass: instrument.assetClass,
  };
}

type TradeInputRow = Pick<
  Trade,
  | "entryMode"
  | "direction"
  | "entryPrice"
  | "exitPrice"
  | "stopLoss"
  | "initialStopLoss"
  | "takeProfit"
  | "volumeLots"
  | "commission"
  | "swap"
  | "conversionRate"
  | "openedAt"
  | "closedAt"
  | "plannedRR"
  | "plannedRisk"
  | "resultR"
>;

/**
 * Build the metrics-layer input from a persisted trade plus its instrument,
 * in whichever mode the trade was recorded. Every recompute path (settings,
 * backfill, restore, fills) goes through here, so an R-mode trade keeps the
 * R its trader typed rather than being re-derived from prices it never had.
 */
export function tradeInput(trade: TradeInputRow, instrument: Instrument, accountCurrency?: string): AnyTradeInput {
  return trade.entryMode === "R_MULTIPLE" ? rTradeInput(trade) : priceTradeInput(trade, instrument, accountCurrency);
}

export function rTradeInput(
  trade: Pick<Trade, "plannedRR" | "plannedRisk" | "resultR" | "commission" | "swap" | "openedAt" | "closedAt">,
): RTradeInput {
  // The database CHECK (migration trade_r_mode) guarantees plannedRisk on an
  // R_MULTIPLE row; a null here means the row was written around it.
  if (trade.plannedRisk === null) throw new Error("R_MULTIPLE trade without plannedRisk");
  return {
    mode: "R_MULTIPLE",
    plannedRR: trade.plannedRR?.toString(),
    plannedRisk: trade.plannedRisk.toString(),
    resultR: trade.resultR?.toString(),
    commission: trade.commission.toString(),
    swap: trade.swap.toString(),
    openedAt: trade.openedAt,
    closedAt: trade.closedAt ?? undefined,
  };
}

/**
 * The price-mode input. `accountCurrency` is what makes the quote-currency
 * conversion correct. It is optional only so that callers computing a preview
 * before an account is known still work; every write path passes it, and
 * `conversionSource` on the result tells the UI whether the number is
 * trustworthy.
 */
export function priceTradeInput(
  trade: Omit<TradeInputRow, "entryMode" | "plannedRR" | "plannedRisk" | "resultR">,
  instrument: Instrument,
  accountCurrency?: string,
): TradeInput {
  // As above: the CHECK constraint makes these non-null on a PRICE row.
  if (trade.entryPrice === null || trade.volumeLots === null) {
    throw new Error("PRICE trade without entryPrice / volumeLots");
  }
  const conversion = accountCurrency
    ? resolveConversion({
        instrument,
        accountCurrency,
        explicitRate: trade.conversionRate?.toString() ?? null,
        // The exit price is the rate that actually realised the P&L; fall back
        // to entry while the position is still open.
        referencePrice: (trade.exitPrice ?? trade.entryPrice).toString(),
      })
    : null;

  return {
    instrument: instrumentSpec(instrument),
    direction: trade.direction,
    entryPrice: trade.entryPrice.toString(),
    exitPrice: trade.exitPrice?.toString(),
    stopLoss: trade.stopLoss?.toString(),
    initialStopLoss: trade.initialStopLoss?.toString(),
    takeProfit: trade.takeProfit?.toString(),
    volumeLots: trade.volumeLots.toString(),
    commission: trade.commission.toString(),
    swap: trade.swap.toString(),
    conversionRate: conversion ? conversion.rate.toString() : trade.conversionRate?.toString(),
    openedAt: trade.openedAt,
    closedAt: trade.closedAt ?? undefined,
  };
}

/** The conversion decision on its own, for the UI to explain. Price mode
 * only: an R-mode trade states its risk in account currency already. */
export function tradeConversion(
  trade: Pick<Trade, "exitPrice" | "conversionRate"> & { entryPrice: Prisma.Decimal },
  instrument: Instrument,
  accountCurrency: string,
) {
  return resolveConversion({
    instrument,
    accountCurrency,
    explicitRate: trade.conversionRate?.toString() ?? null,
    referencePrice: (trade.exitPrice ?? trade.entryPrice).toString(),
  });
}

/** The exact set of columns this service owns. Nothing else may write them. */
export type DerivedColumns = Pick<
  Prisma.TradeUncheckedUpdateInput,
  "grossPnl" | "netPnl" | "pips" | "rMultiple" | "riskAmount" | "holdingMinutes" | "marketSession"
>;

export function derivedColumns(input: AnyTradeInput): DerivedColumns {
  const r = computeAnyTrade(input);
  return {
    grossPnl: fromDec(r.grossPnl),
    netPnl: fromDec(r.netPnl),
    pips: fromDec(r.pips),
    rMultiple: fromDec(r.rMultiple),
    riskAmount: fromDec(r.riskAmount),
    holdingMinutes: r.holdingMinutes,
    marketSession: marketSession(input.openedAt),
  };
}

/**
 * DB row -> the minimal shape the aggregate functions consume. Uses the STORED
 * derived columns (not a recompute) so a report can never disagree with the
 * number shown on the trade itself.
 */
export function toTradeRow(
  trade: Pick<Trade, "netPnl" | "rMultiple" | "openedAt" | "closedAt" | "holdingMinutes" | "status">,
): TradeRow {
  const netPnl = toDec(trade.netPnl);
  return {
    netPnl,
    rMultiple: toDec(trade.rMultiple),
    // Delegated rather than reimplemented. This was an inline ternary chain
    // with its own hardcoded "0.005", which is the same rule written a second
    // time — and the copy that would drift. `classifyOutcome` takes a binary
    // status, so CANCELLED maps to OPEN here: a cancelled order never filled,
    // so it has no outcome to classify.
    outcome: classifyOutcome(netPnl, trade.status === "CLOSED" ? "CLOSED" : "OPEN"),
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    holdingMinutes: trade.holdingMinutes,
  };
}

/**
 * Whether a trade states its risk up front. For a PRICE trade that is a stop
 * loss; an R_MULTIPLE trade always does, because its money at risk is
 * required. Every "no stop" count and warning asks this rather than reading
 * `stopLoss` directly, or every R-mode trade would be flagged as naked.
 */
export function hasDefinedRisk(trade: Pick<Trade, "entryMode" | "stopLoss">): boolean {
  return trade.entryMode === "R_MULTIPLE" || trade.stopLoss !== null;
}

/** Sum of realised net P&L, used for account equity. */
export function realisedPnl(trades: { netPnl: Prisma.Decimal | null }[]): Decimal {
  return trades.reduce((acc, t) => acc.plus(toDecOr(t.netPnl, 0)), new Decimal(0));
}
