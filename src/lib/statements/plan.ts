/**
 * Parsed statement + what the database already holds -> what an import would
 * do, row by row. Pure (no Prisma client, no session): the import action
 * gathers the inputs, calls this, and either returns it as the preview or
 * writes it. One function decides both, so the preview cannot promise
 * something the import then does differently.
 */
import type { Instrument } from "@prisma/client";
import { resolveConversion } from "@/lib/conversion";
import { derivedColumns, instrumentSpec } from "@/lib/trade-service";
import type { TradeInput } from "@/lib/metrics/types";
import { reconcile, type Reconciliation } from "./reconcile";
import { resolveSymbol } from "./symbols";
import type { ParseStatementResult, ParsedBalanceEvent, ParsedPosition } from "./types";

export type PlannedStatus =
  /** Not in the account yet: will be created. */
  | "new"
  /** Already imported (same broker ticket) and nothing to change. */
  | "duplicate"
  /** Imported earlier while OPEN, closed in this statement: the close is
   * applied — exit, costs, broker profit, derived columns. Notes, tags and
   * discipline fields are never touched. */
  | "close"
  /** The symbol could not be matched to an instrument; skipped unless the
   * user maps it in the preview. */
  | "unmapped";

export interface PlannedPosition {
  position: ParsedPosition;
  symbol: string | null;
  status: PlannedStatus;
  /** Present for new/close rows. */
  reconciliation: Reconciliation | null;
  /** The derived columns as they will be stored, for new/close rows. */
  derived: ReturnType<typeof derivedColumns> | null;
  /** Existing trade id, for close rows. */
  existingId: string | null;
}

export interface PlannedBalanceEvent {
  event: ParsedBalanceEvent;
  status: "new" | "duplicate";
}

export interface ImportPlan {
  positions: PlannedPosition[];
  balanceEvents: PlannedBalanceEvent[];
  /** Broker symbols nothing could be matched to — the preview asks about these. */
  unmappedSymbols: string[];
}

export interface PlanContext {
  accountCurrency: string;
  instruments: ReadonlyMap<string, Instrument>;
  /** Upper-cased broker symbol -> instrument symbol (saved + just submitted). */
  aliases: ReadonlyMap<string, string>;
  /** Trades already in the account that came from a statement, by ticket. */
  existingTrades: ReadonlyMap<string, { id: string; status: string }>;
  /** Balance-event tickets already in the account. */
  existingBalanceTickets: ReadonlySet<string>;
}

export function tradeInputFor(
  position: ParsedPosition,
  instrument: Instrument,
  accountCurrency: string,
  conversionRate: string | null,
): TradeInput {
  const conversion = resolveConversion({
    instrument,
    accountCurrency,
    explicitRate: conversionRate,
    referencePrice: position.exitPrice ?? position.entryPrice,
  });
  return {
    instrument: instrumentSpec(instrument),
    direction: position.direction,
    entryPrice: position.entryPrice,
    exitPrice: position.exitPrice ?? undefined,
    stopLoss: position.stopLoss ?? undefined,
    takeProfit: position.takeProfit ?? undefined,
    volumeLots: position.volumeLots,
    commission: position.commission,
    swap: position.swap,
    conversionRate: conversion.rate.toString(),
    openedAt: new Date(position.openedAt),
    closedAt: position.closedAt === null ? undefined : new Date(position.closedAt),
  };
}

export function planImport(parsed: ParseStatementResult, ctx: PlanContext): ImportPlan {
  const known = new Set(ctx.instruments.keys());
  const unmapped = new Set<string>();

  const positions = parsed.positions.map((position): PlannedPosition => {
    const symbol = resolveSymbol(position.symbolRaw, known, ctx.aliases);
    const existing = ctx.existingTrades.get(position.ticket) ?? null;

    if (existing && !(existing.status === "OPEN" && position.closedAt !== null)) {
      return { position, symbol, status: "duplicate", reconciliation: null, derived: null, existingId: existing.id };
    }
    if (!symbol) {
      unmapped.add(position.symbolRaw.trim().toUpperCase());
      return { position, symbol: null, status: "unmapped", reconciliation: null, derived: null, existingId: null };
    }

    const instrument = ctx.instruments.get(symbol)!;
    const reconciliation = reconcile(
      position,
      {
        symbol,
        baseCurrency: instrument.baseCurrency,
        quoteCurrency: instrument.quoteCurrency,
        contractSize: instrument.contractSize.toString(),
      },
      ctx.accountCurrency,
    );
    const derived = derivedColumns(
      tradeInputFor(position, instrument, ctx.accountCurrency, reconciliation.conversionRate),
    );
    return {
      position,
      symbol,
      status: existing ? "close" : "new",
      reconciliation,
      derived,
      existingId: existing?.id ?? null,
    };
  });

  const balanceEvents = parsed.balanceEvents.map((event): PlannedBalanceEvent => ({
    event,
    status: ctx.existingBalanceTickets.has(event.ticket) ? "duplicate" : "new",
  }));

  return { positions, balanceEvents, unmappedSymbols: [...unmapped].sort() };
}
