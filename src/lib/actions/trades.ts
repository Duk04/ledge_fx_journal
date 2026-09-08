"use server";

import { revalidatePath } from "next/cache";
import type { Instrument, MarketSession } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getInstrument, listActiveSymbols } from "@/lib/queries/instruments";
import { NotFoundError, requireAccountAccess, requireUser } from "@/lib/session";
import { closeTradeSchema, parseTradeForm, type TradeFormValues } from "@/lib/schemas/trade";
import { derivedColumns, instrumentSpec } from "@/lib/trade-service";
import { resolveConversion } from "@/lib/conversion";
import type { TradeInput } from "@/lib/metrics/types";

/**
 * Trade writes. Every action here follows the same shape: authenticate,
 * confirm the account belongs to this user, validate, write, revalidate —
 * and return a result object instead of throwing, because a server action
 * wired to a form's `action` prop has no try/catch on the caller's side to
 * catch a thrown error with; a rejected promise there just breaks the page.
 */

export type ActionResult = { ok: true; id: string } | { ok: false; fieldErrors?: Record<string, string[]>; formError?: string };


/**
 * `derivedColumns()` is typed against `Prisma.TradeUncheckedUpdateInput`
 * (see trade-service.ts), whose Decimal fields additionally accept update
 * *operation* objects (e.g. `{ increment: 5 }`) that a `create` call's input
 * type doesn't. At runtime it only ever returns plain `string | null` values
 * for these (see `fromDec()`), so re-typing the numeric columns down to that
 * plain shape for a `create` payload is safe — this is a create/update input
 * shape mismatch, not a risk of the wrong value landing here. `marketSession`
 */
type PlainDerivedNumbers = {
  grossPnl: string | null;
  netPnl: string | null;
  pips: string | null;
  rMultiple: string | null;
  riskAmount: string | null;
  holdingMinutes: number | null;
  marketSession: MarketSession | null;
};

/** Builds the metrics-layer input straight from validated form values —
 * `tradeInput()` in trade-service.ts exists for the DB-row shape (Prisma
 * `Decimal`s); form values are already plain numbers, so this is the
 * form-side equivalent of the same mapping. */
/**
 * The form gives us raw numbers; the quote-currency conversion has to be
 * resolved here, against the account's currency, or a JPY-quoted trade in a USD
 * account records a P&L that is wrong by two orders of magnitude. See
 * src/lib/conversion.ts for why this is never allowed to default silently.
 */
function formTradeInput(
  values: TradeFormValues,
  instrument: Instrument,
  accountCurrency: string,
): TradeInput {
  const conversion = resolveConversion({
    instrument,
    accountCurrency,
    explicitRate: values.conversionRate ?? null,
    referencePrice: values.exitPrice ?? values.entryPrice,
  });
  return {
    instrument: instrumentSpec(instrument),
    direction: values.direction,
    entryPrice: values.entryPrice,
    exitPrice: values.exitPrice,
    stopLoss: values.stopLoss,
    takeProfit: values.takeProfit,
    volumeLots: values.volumeLots,
    commission: values.commission ?? 0,
    swap: values.swap ?? 0,
    conversionRate: conversion.rate.toString(),
    openedAt: values.openedAt,
    closedAt: values.closedAt,
  };
}

/** Confirms every id in `tagIds` is a real tag owned by `userId`. Returns
 * null (rather than throwing) if any id doesn't check out, so the caller can
 * turn it into a field error instead of a 500. */
async function assertTagsOwned(userId: string, tagIds: string[]): Promise<string[] | null> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return [];
  const owned = await prisma.tag.findMany({ where: { userId, id: { in: unique } }, select: { id: true } });
  if (owned.length !== unique.length) return null;
  return unique;
}

function revalidateTradeViews(tradeId?: string) {
  revalidatePath("/trades");
  if (tradeId) revalidatePath(`/trades/${tradeId}`);
}

// ---------------------------------------------------------------------------
// createTrade
// ---------------------------------------------------------------------------

export async function createTrade(accountId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let account;
  try {
    account = await requireAccountAccess(accountId);
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, formError: err.message };
    throw err;
  }

  const symbols = await listActiveSymbols();
  const parsed = parseTradeForm(formData, { validSymbols: symbols });
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors };

  const instrument = await getInstrument(parsed.values.symbol);
  if (!instrument) return { ok: false, fieldErrors: { symbol: ["Unknown symbol."] } };

  const tagIds = await assertTagsOwned(user.id, parsed.values.tagIds);
  if (tagIds === null) return { ok: false, fieldErrors: { tagIds: ["One or more tags could not be found."] } };

  const derived = derivedColumns(formTradeInput(parsed.values, instrument, account.currency));

  const trade = await prisma.trade.create({
    data: {
      accountId: account.id,
      symbol: instrument.symbol,
      direction: parsed.values.direction,
      status: parsed.values.status,
      openedAt: parsed.values.openedAt,
      closedAt: parsed.values.closedAt ?? null,
      entryPrice: parsed.values.entryPrice.toString(),
      exitPrice: parsed.values.exitPrice?.toString() ?? null,
      stopLoss: parsed.values.stopLoss?.toString() ?? null,
      takeProfit: parsed.values.takeProfit?.toString() ?? null,
      volumeLots: parsed.values.volumeLots.toString(),
      commission: (parsed.values.commission ?? 0).toString(),
      swap: (parsed.values.swap ?? 0).toString(),
      conversionRate: parsed.values.conversionRate?.toString() ?? null,
      followedPlan: parsed.values.followedPlan ?? null,
      emotion: parsed.values.emotion ?? null,
      confidence: parsed.values.confidence ?? null,
      notes: parsed.values.notes ?? null,
      ...(derived as unknown as PlainDerivedNumbers),
      tradeTags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
    },
  });

  revalidateTradeViews(trade.id);
  return { ok: true, id: trade.id };
}

// ---------------------------------------------------------------------------
// updateTrade
// ---------------------------------------------------------------------------

export async function updateTrade(accountId: string, tradeId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let account;
  try {
    account = await requireAccountAccess(accountId);
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, formError: err.message };
    throw err;
  }

  const existing = await prisma.trade.findFirst({ where: { id: tradeId, accountId: account.id } });
  if (!existing) return { ok: false, formError: "Trade not found." };

  const symbols = await listActiveSymbols();
  const parsed = parseTradeForm(formData, { validSymbols: symbols });
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors };

  const instrument = await getInstrument(parsed.values.symbol);
  if (!instrument) return { ok: false, fieldErrors: { symbol: ["Unknown symbol."] } };

  const tagIds = await assertTagsOwned(user.id, parsed.values.tagIds);
  if (tagIds === null) return { ok: false, fieldErrors: { tagIds: ["One or more tags could not be found."] } };

  const derived = derivedColumns(formTradeInput(parsed.values, instrument, account.currency));

  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      symbol: instrument.symbol,
      direction: parsed.values.direction,
      status: parsed.values.status,
      openedAt: parsed.values.openedAt,
      closedAt: parsed.values.closedAt ?? null,
      entryPrice: parsed.values.entryPrice.toString(),
      exitPrice: parsed.values.exitPrice?.toString() ?? null,
      stopLoss: parsed.values.stopLoss?.toString() ?? null,
      takeProfit: parsed.values.takeProfit?.toString() ?? null,
      volumeLots: parsed.values.volumeLots.toString(),
      commission: (parsed.values.commission ?? 0).toString(),
      swap: (parsed.values.swap ?? 0).toString(),
      conversionRate: parsed.values.conversionRate?.toString() ?? null,
      followedPlan: parsed.values.followedPlan ?? null,
      emotion: parsed.values.emotion ?? null,
      confidence: parsed.values.confidence ?? null,
      notes: parsed.values.notes ?? null,
      ...derived,
      tradeTags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) },
    },
  });

  revalidateTradeViews(tradeId);
  return { ok: true, id: tradeId };
}

// ---------------------------------------------------------------------------
// deleteTrade
// ---------------------------------------------------------------------------

export async function deleteTrade(accountId: string, tradeId: string): Promise<ActionResult> {
  try {
    await requireAccountAccess(accountId);
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, formError: err.message };
    throw err;
  }

  const existing = await prisma.trade.findFirst({ where: { id: tradeId, accountId }, select: { id: true } });
  if (!existing) return { ok: false, formError: "Trade not found." };

  await prisma.trade.delete({ where: { id: tradeId } });
  revalidateTradeViews();
  return { ok: true, id: tradeId };
}

// ---------------------------------------------------------------------------
// closeTrade — the common case: just an exit price and a close time.
// ---------------------------------------------------------------------------

export async function closeTrade(
  accountId: string,
  tradeId: string,
  input: { exitPrice: string | number; closedAt: string | Date },
): Promise<ActionResult> {
  let account;
  try {
    account = await requireAccountAccess(accountId);
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, formError: err.message };
    throw err;
  }

  const parsed = closeTradeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }

  const existing = await prisma.trade.findFirst({
    where: { id: tradeId, accountId },
    include: { instrument: true },
  });
  if (!existing) return { ok: false, formError: "Trade not found." };
  if (parsed.data.closedAt.getTime() < existing.openedAt.getTime()) {
    return { ok: false, fieldErrors: { closedAt: ["Close time cannot be before the open time."] } };
  }

  const derived = derivedColumns({
    instrument: instrumentSpec(existing.instrument),
    direction: existing.direction,
    entryPrice: existing.entryPrice.toString(),
    exitPrice: parsed.data.exitPrice.toString(),
    stopLoss: existing.stopLoss?.toString(),
    takeProfit: existing.takeProfit?.toString(),
    volumeLots: existing.volumeLots.toString(),
    commission: existing.commission.toString(),
    swap: existing.swap.toString(),
    // The exit price we are about to store is the rate that realised this
    // trade, so resolve the conversion against it rather than the entry.
    conversionRate: resolveConversion({
      instrument: existing.instrument,
      accountCurrency: account.currency,
      explicitRate: existing.conversionRate?.toString() ?? null,
      referencePrice: parsed.data.exitPrice,
    }).rate.toString(),
    openedAt: existing.openedAt,
    closedAt: parsed.data.closedAt,
  });

  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status: "CLOSED",
      exitPrice: parsed.data.exitPrice.toString(),
      closedAt: parsed.data.closedAt,
      ...derived,
    },
  });

  revalidateTradeViews(tradeId);
  return { ok: true, id: tradeId };
}

// ---------------------------------------------------------------------------
// setTradeTags
// ---------------------------------------------------------------------------

export async function setTradeTags(accountId: string, tradeId: string, tagIds: string[]): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await requireAccountAccess(accountId);
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, formError: err.message };
    throw err;
  }

  const existing = await prisma.trade.findFirst({ where: { id: tradeId, accountId }, select: { id: true } });
  if (!existing) return { ok: false, formError: "Trade not found." };

  const owned = await assertTagsOwned(user.id, tagIds);
  if (owned === null) return { ok: false, fieldErrors: { tagIds: ["One or more tags could not be found."] } };

  await prisma.trade.update({
    where: { id: tradeId },
    data: { tradeTags: { deleteMany: {}, create: owned.map((tagId) => ({ tagId })) } },
  });

  revalidateTradeViews(tradeId);
  return { ok: true, id: tradeId };
}

// ---------------------------------------------------------------------------
// duplicateTrade — a fast way to log "another one of these, right now".
// ---------------------------------------------------------------------------

export async function duplicateTrade(accountId: string, tradeId: string): Promise<ActionResult> {
  try {
    await requireAccountAccess(accountId);
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, formError: err.message };
    throw err;
  }

  const existing = await prisma.trade.findFirst({
    where: { id: tradeId, accountId },
    include: { tradeTags: true },
  });
  if (!existing) return { ok: false, formError: "Trade not found." };

  // A duplicate is deliberately a fresh, OPEN position: same symbol,
  // direction, size and planned stop/target, opened "now" — the setup you
  // just logged is one you're about to take again, not a second copy of
  // history with a fabricated close. Discipline fields (emotion, confidence,
  // followedPlan, notes) are left blank since they describe THIS occurrence.
  const created = await prisma.trade.create({
    data: {
      accountId,
      symbol: existing.symbol,
      direction: existing.direction,
      status: "OPEN",
      openedAt: new Date(),
      entryPrice: existing.entryPrice,
      stopLoss: existing.stopLoss,
      takeProfit: existing.takeProfit,
      volumeLots: existing.volumeLots,
      conversionRate: existing.conversionRate,
      tradeTags: existing.tradeTags.length
        ? { create: existing.tradeTags.map((tt) => ({ tagId: tt.tagId })) }
        : undefined,
    },
  });

  revalidateTradeViews(created.id);
  return { ok: true, id: created.id };
}
