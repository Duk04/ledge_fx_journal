import type { Instrument, Prisma, Trade } from "@prisma/client";
import { Decimal } from "decimal.js";
import { computeTrade, marketSession, validateTradeGeometry, classifyOutcome } from "@/lib/metrics";
import type { InstrumentSpec, TradeInput, TradeRow } from "@/lib/metrics/types";
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

/**
 * Build the metrics-layer input from a persisted trade plus its instrument.
 *
 * `accountCurrency` is what makes the quote-currency conversion correct. It is
 * optional only so that callers computing a preview before an account is known
 * still work; every write path passes it, and `conversionSource` on the result
 * tells the UI whether the number is trustworthy.
 */
export function tradeInput(
  trade: Pick<
    Trade,
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
  >,
  instrument: Instrument,
  accountCurrency?: string,
): TradeInput {
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

/** The conversion decision on its own, for the UI to explain. */
export function tradeConversion(
  trade: Pick<Trade, "entryPrice" | "exitPrice" | "conversionRate">,
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

export function derivedColumns(input: TradeInput): DerivedColumns {
  const r = computeTrade(input);
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

/** Convenience for the write path: geometry problems + the derived columns. */
export function prepareTradeWrite(input: TradeInput) {
  return {
    problems: validateTradeGeometry(input),
    derived: derivedColumns(input),
    result: computeTrade(input),
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

/** Sum of realised net P&L, used for account equity. */
export function realisedPnl(trades: { netPnl: Prisma.Decimal | null }[]): Decimal {
  return trades.reduce((acc, t) => acc.plus(toDecOr(t.netPnl, 0)), new Decimal(0));
}
