"use server";

import { revalidatePath } from "next/cache";
import type { Instrument, MarketSession } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, failFields, ok, type ActionResult } from "./result";
import { getInstrument, listActiveSymbols } from "@/lib/queries/instruments";
import { requireUser } from "@/lib/session";
import { accountOrFailure } from "./guard";
import { closeTradeSchema, parseTradeForm, type TradeFormValues } from "@/lib/schemas/trade";
import { derivedColumns, instrumentSpec } from "@/lib/trade-service";
import { resolveConversion } from "@/lib/conversion";
import type { TradeInput } from "@/lib/metrics/types";
import { hasMultipleFills, simpleExecutionsCreate, syncTradeFromFills, toFill } from "./fills-store";
import { aggregateFills, validateFills } from "@/lib/metrics/fills";
import { Decimal } from "decimal.js";

/**
 * Trade writes. Every action here follows the same shape: authenticate,
 * confirm the account belongs to this user, validate, write, revalidate —
 * and return a result object instead of throwing, because a server action
 * wired to a form's `action` prop has no try/catch on the caller's side to
 * catch a thrown error with; a rejected promise there just breaks the page.
 */

/**
 * Every write here reports the trade it touched.
 *
 * This module's local type was the one the shared `ActionResult<T>` was
 * modelled on: a real discriminated union with a REQUIRED payload on the
 * success arm, rather than the seven `{ ok: boolean }` interfaces the other
 * action modules had. Kept as a named alias because the name reads well at
 * six call sites, and because the components importing it need not change.
 */
type TradeResult = ActionResult<{ id: string }>;

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
  /** The stop R is measured from, when it is not simply the form's value
   * (an edit that leaves the field blank keeps the stored one). */
  initialStopLoss?: string | null,
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
    initialStopLoss: initialStopLoss ?? values.initialStopLoss ?? values.stopLoss,
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

export async function createTrade(accountId: string, formData: FormData): Promise<TradeResult> {
  const user = await requireUser();
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;
  const account = found.account;

  const symbols = await listActiveSymbols();
  const parsed = parseTradeForm(formData, { validSymbols: symbols });
  if (!parsed.ok) return failFields(parsed.fieldErrors);

  const instrument = await getInstrument(parsed.values.symbol);
  if (!instrument) return failFields({ symbol: ["Unknown symbol."] });

  const tagIds = await assertTagsOwned(user.id, parsed.values.tagIds);
  if (tagIds === null) return failFields({ tagIds: ["One or more tags could not be found."] });

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
      initialStopLoss: (parsed.values.initialStopLoss ?? parsed.values.stopLoss)?.toString() ?? null,
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
      executions: { create: simpleExecutionsCreate(parsed.values) },
    },
  });

  revalidateTradeViews(trade.id);
  return ok({ id: trade.id });
}

// ---------------------------------------------------------------------------
// updateTrade
// ---------------------------------------------------------------------------

export async function updateTrade(accountId: string, tradeId: string, formData: FormData): Promise<TradeResult> {
  const user = await requireUser();
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;
  const account = found.account;

  const existing = await prisma.trade.findFirst({
    where: { id: tradeId, accountId: account.id },
    include: { executions: { select: { kind: true } } },
  });
  if (!existing) return fail("Trade not found.");

  const symbols = await listActiveSymbols();
  const parsed = parseTradeForm(formData, { validSymbols: symbols });
  if (!parsed.ok) return failFields(parsed.fieldErrors);

  const instrument = await getInstrument(parsed.values.symbol);
  if (!instrument) return failFields({ symbol: ["Unknown symbol."] });

  const tagIds = await assertTagsOwned(user.id, parsed.values.tagIds);
  if (tagIds === null) return failFields({ tagIds: ["One or more tags could not be found."] });

  // Everything the fills do NOT own. `initialStopLoss` keeps its stored value
  // when the field is left blank, and only falls back to the stop for a trade
  // that never had one.
  const descriptive = {
    stopLoss: parsed.values.stopLoss?.toString() ?? null,
    initialStopLoss:
      (parsed.values.initialStopLoss ?? existing.initialStopLoss ?? parsed.values.stopLoss)?.toString() ?? null,
    takeProfit: parsed.values.takeProfit?.toString() ?? null,
    commission: (parsed.values.commission ?? 0).toString(),
    swap: (parsed.values.swap ?? 0).toString(),
    conversionRate: parsed.values.conversionRate?.toString() ?? null,
    followedPlan: parsed.values.followedPlan ?? null,
    emotion: parsed.values.emotion ?? null,
    confidence: parsed.values.confidence ?? null,
    notes: parsed.values.notes ?? null,
    tradeTags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) },
  };

  if (hasMultipleFills(existing.executions)) {
    // Scaled in or partly closed: prices, size, times and status come from
    // the fills, which the form cannot express. Those form fields are
    // read-only in that case, and are ignored here regardless — this is an
    // endpoint, and a crafted POST must not desync the aggregate.
    await prisma.$transaction(async (tx) => {
      await tx.trade.update({ where: { id: tradeId }, data: descriptive });
      await syncTradeFromFills(tx, tradeId, account.currency);
    });
  } else {
    const derived = derivedColumns(
      formTradeInput(parsed.values, instrument, account.currency, descriptive.initialStopLoss),
    );
    await prisma.trade.update({
      where: { id: tradeId },
      data: {
        ...descriptive,
        symbol: instrument.symbol,
        direction: parsed.values.direction,
        status: parsed.values.status,
        openedAt: parsed.values.openedAt,
        closedAt: parsed.values.closedAt ?? null,
        entryPrice: parsed.values.entryPrice.toString(),
        exitPrice: parsed.values.exitPrice?.toString() ?? null,
        volumeLots: parsed.values.volumeLots.toString(),
        ...derived,
        // The one entry (and exit) the form describes, replacing the old.
        executions: { deleteMany: {}, create: simpleExecutionsCreate(parsed.values) },
      },
    });
  }

  revalidateTradeViews(tradeId);
  return ok({ id: tradeId });
}

// ---------------------------------------------------------------------------
// deleteTrade
// ---------------------------------------------------------------------------

export async function deleteTrade(accountId: string, tradeId: string): Promise<TradeResult> {
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;

  const existing = await prisma.trade.findFirst({ where: { id: tradeId, accountId }, select: { id: true } });
  if (!existing) return fail("Trade not found.");

  await prisma.trade.delete({ where: { id: tradeId } });
  revalidateTradeViews();
  return ok({ id: tradeId });
}

// ---------------------------------------------------------------------------
// closeTrade — an exit price and a close time; optionally only part of the
// position (a partial close keeps the trade OPEN — lib/metrics/fills.ts).
// ---------------------------------------------------------------------------

export async function closeTrade(
  accountId: string,
  tradeId: string,
  input: { exitPrice: string | number; closedAt: string | Date; volumeLots?: string | number | null },
): Promise<TradeResult> {
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;
  const account = found.account;

  const parsed = closeTradeSchema.safeParse(input);
  if (!parsed.success) {
    return failFields(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }

  const existing = await prisma.trade.findFirst({
    where: { id: tradeId, accountId },
    include: { executions: true },
  });
  if (!existing) return fail("Trade not found.");
  if (existing.status !== "OPEN") return fail("Only an open trade can be closed.");
  if (parsed.data.closedAt.getTime() < existing.openedAt.getTime()) {
    return failFields({ closedAt: ["Close time cannot be before the open time."] });
  }

  const fills = existing.executions.map(toFill);
  const { volumeLots: entered, exitedLots } = aggregateFills(fills);
  const open = entered.minus(exitedLots);
  const lots = parsed.data.volumeLots === undefined ? open : new Decimal(parsed.data.volumeLots);
  if (lots.gt(open)) {
    return failFields({ volumeLots: [`Only ${open.toString()} lots are still open.`] });
  }
  const problems = validateFills([
    ...fills,
    { kind: "EXIT", executedAt: parsed.data.closedAt, price: parsed.data.exitPrice, volumeLots: lots },
  ]);
  if (problems.length) return failFields({ closedAt: [problems[0].message] });

  await prisma.$transaction(async (tx) => {
    await tx.execution.create({
      data: {
        tradeId,
        kind: "EXIT",
        executedAt: parsed.data.closedAt,
        price: parsed.data.exitPrice.toString(),
        volumeLots: lots.toString(),
      },
    });
    await syncTradeFromFills(tx, tradeId, account.currency);
  });

  revalidateTradeViews(tradeId);
  return ok({ id: tradeId });
}

// ---------------------------------------------------------------------------
// setTradeTags
// ---------------------------------------------------------------------------

export async function setTradeTags(accountId: string, tradeId: string, tagIds: string[]): Promise<TradeResult> {
  const user = await requireUser();
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;

  const existing = await prisma.trade.findFirst({ where: { id: tradeId, accountId }, select: { id: true } });
  if (!existing) return fail("Trade not found.");

  const owned = await assertTagsOwned(user.id, tagIds);
  if (owned === null) return failFields({ tagIds: ["One or more tags could not be found."] });

  await prisma.trade.update({
    where: { id: tradeId },
    data: { tradeTags: { deleteMany: {}, create: owned.map((tagId) => ({ tagId })) } },
  });

  revalidateTradeViews(tradeId);
  return ok({ id: tradeId });
}

// ---------------------------------------------------------------------------
// duplicateTrade — a fast way to log "another one of these, right now".
// ---------------------------------------------------------------------------

export async function duplicateTrade(accountId: string, tradeId: string): Promise<TradeResult> {
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;

  const existing = await prisma.trade.findFirst({
    where: { id: tradeId, accountId },
    include: { tradeTags: true },
  });
  if (!existing) return fail("Trade not found.");

  // A duplicate is deliberately a fresh, OPEN position: same symbol,
  // direction, size and planned stop/target, opened "now" — the setup you
  // just logged is one you're about to take again, not a second copy of
  // history with a fabricated close. Discipline fields (emotion, confidence,
  // followedPlan, notes) are left blank since they describe THIS occurrence.
  const now = new Date();
  const created = await prisma.trade.create({
    data: {
      accountId,
      symbol: existing.symbol,
      direction: existing.direction,
      status: "OPEN",
      openedAt: now,
      entryPrice: existing.entryPrice,
      stopLoss: existing.stopLoss,
      initialStopLoss: existing.initialStopLoss ?? existing.stopLoss,
      takeProfit: existing.takeProfit,
      volumeLots: existing.volumeLots,
      conversionRate: existing.conversionRate,
      tradeTags: existing.tradeTags.length
        ? { create: existing.tradeTags.map((tt) => ({ tagId: tt.tagId })) }
        : undefined,
      executions: {
        create: [{ kind: "ENTRY", executedAt: now, price: existing.entryPrice, volumeLots: existing.volumeLots }],
      },
    },
  });

  revalidateTradeViews(created.id);
  return ok({ id: created.id });
}
