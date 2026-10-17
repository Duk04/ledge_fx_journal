"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type Instrument, type MarketSession } from "@prisma/client";
import { prisma } from "@/lib/db";
import { failFields, ok, type ActionResult } from "./result";
import { getInstrument, listActiveSymbols } from "@/lib/queries/instruments";
import { requireUser } from "@/lib/session";
import { accountOrFailure } from "./guard";
import {
  closeRTradeSchema,
  closeTradeSchema,
  formEntryMode,
  parseRTradeForm,
  parseTradeForm,
  type RTradeFormValues,
  type TradeFormValues,
} from "@/lib/schemas/trade";
import { derivedColumns, instrumentSpec, rTradeInput } from "@/lib/trade-service";
import { resolveConversion } from "@/lib/conversion";
import type { RTradeInput, TradeInput } from "@/lib/metrics/types";
import { hasMultipleFills, simpleExecutionsCreate, syncTradeFromFills, toFill } from "./fills-store";
import { aggregateFills, validateFills } from "@/lib/metrics/fills";
import { Decimal } from "decimal.js";
import { failT, failZod, tr } from "@/i18n/server-t";

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

/** The R-mode counterpart: no instrument maths and no conversion, because
 * the risk is already stated in account currency. */
function formRTradeInput(values: RTradeFormValues): RTradeInput {
  return {
    mode: "R_MULTIPLE",
    plannedRR: values.plannedRR,
    plannedRisk: values.plannedRisk,
    // An open trade has no result yet, whatever the field holds.
    resultR: values.status === "CLOSED" ? values.resultR : undefined,
    commission: values.commission ?? 0,
    swap: values.swap ?? 0,
    openedAt: values.openedAt,
    closedAt: values.status === "CLOSED" ? values.closedAt : undefined,
  };
}

/** The columns an R-mode form owns, for create and update alike. */
function rModeColumns(values: RTradeFormValues) {
  const closed = values.status === "CLOSED";
  return {
    entryMode: "R_MULTIPLE" as const,
    symbol: values.symbol,
    direction: values.direction,
    status: values.status,
    openedAt: values.openedAt,
    closedAt: closed ? (values.closedAt ?? null) : null,
    plannedRisk: values.plannedRisk.toString(),
    plannedRR: values.plannedRR?.toString() ?? null,
    resultR: closed ? (values.resultR?.toString() ?? null) : null,
    volumeLots: values.volumeLots?.toString() ?? null,
    commission: (values.commission ?? 0).toString(),
    swap: (values.swap ?? 0).toString(),
    followedPlan: values.followedPlan ?? null,
    emotion: values.emotion ?? null,
    confidence: values.confidence ?? null,
    notes: values.notes ?? null,
    ...(derivedColumns(formRTradeInput(values)) as unknown as PlainDerivedNumbers),
  };
}

/** Confirms every id in `tagIds` is a real tag owned by `userId`. Returns
 * null (rather than throwing) if any id doesn't check out, so the caller can
 * turn it into a field error instead of a 500. */
/** The playbook id if it is the user's, undefined for none, null if it isn't
 * theirs (a field error, like a foreign tag). */
async function ownedPlaybook(userId: string, playbookId: string | undefined): Promise<string | undefined | null> {
  if (!playbookId) return undefined;
  const pb = await prisma.playbook.findFirst({ where: { id: playbookId, userId }, select: { id: true } });
  return pb ? pb.id : null;
}

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

  if (formEntryMode(formData) === "R_MULTIPLE") {
    const parsedR = parseRTradeForm(formData, { validSymbols: symbols });
    if (!parsedR.ok) return failFields(parsedR.fieldErrors);
    const instrument = await getInstrument(parsedR.values.symbol);
    if (!instrument) return failFields({ symbol: [await tr("unknownSymbolShort")] });
    const tagIds = await assertTagsOwned(user.id, parsedR.values.tagIds);
    if (tagIds === null) return failFields({ tagIds: [await tr("tagsNotFound")] });
    const playbookId = await ownedPlaybook(user.id, parsedR.values.playbookId);
    if (playbookId === null) return failFields({ playbookId: [await tr("playbookNotFound")] });

    // No executions: an R-mode trade has no fill prices, and Execution.price
    // is NOT NULL for good reason. See docs/TRADES.md.
    const trade = await prisma.trade.create({
      data: {
        accountId: account.id,
        ...rModeColumns({ ...parsedR.values, symbol: instrument.symbol }),
        tradeTags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        playbookId: playbookId ?? null,
      },
    });
    revalidateTradeViews(trade.id);
    return ok({ id: trade.id });
  }

  const parsed = parseTradeForm(formData, { validSymbols: symbols });
  if (!parsed.ok) return failFields(parsed.fieldErrors);

  const instrument = await getInstrument(parsed.values.symbol);
  if (!instrument) return failFields({ symbol: [await tr("unknownSymbolShort")] });

  const tagIds = await assertTagsOwned(user.id, parsed.values.tagIds);
  if (tagIds === null) return failFields({ tagIds: [await tr("tagsNotFound")] });
  const playbookId = await ownedPlaybook(user.id, parsed.values.playbookId);
  if (playbookId === null) return failFields({ playbookId: [await tr("playbookNotFound")] });

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
      maePrice: parsed.values.maePrice?.toString() ?? null,
      mfePrice: parsed.values.mfePrice?.toString() ?? null,
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
      playbookId: playbookId ?? null,
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
  if (!existing) return failT("tradeNotFound");

  const symbols = await listActiveSymbols();

  // The stored mode decides which form this is, not the POST: a trade does
  // not change how it was recorded by being edited.
  if (existing.entryMode === "R_MULTIPLE") {
    const parsedR = parseRTradeForm(formData, { validSymbols: symbols });
    if (!parsedR.ok) return failFields(parsedR.fieldErrors);
    const instrument = await getInstrument(parsedR.values.symbol);
    if (!instrument) return failFields({ symbol: [await tr("unknownSymbolShort")] });
    const tagIds = await assertTagsOwned(user.id, parsedR.values.tagIds);
    if (tagIds === null) return failFields({ tagIds: [await tr("tagsNotFound")] });
    const playbookId = await ownedPlaybook(user.id, parsedR.values.playbookId);
    if (playbookId === null) return failFields({ playbookId: [await tr("playbookNotFound")] });

    await prisma.trade.update({
      where: { id: tradeId },
      data: {
        ...rModeColumns({ ...parsedR.values, symbol: instrument.symbol }),
        tradeTags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) },
        playbookId: playbookId ?? null,
        ...(existing.playbookId !== (playbookId ?? null) ? { ruleChecks: { deleteMany: {} } } : {}),
      },
    });
    revalidateTradeViews(tradeId);
    return ok({ id: tradeId });
  }

  const parsed = parseTradeForm(formData, { validSymbols: symbols });
  if (!parsed.ok) return failFields(parsed.fieldErrors);

  const instrument = await getInstrument(parsed.values.symbol);
  if (!instrument) return failFields({ symbol: [await tr("unknownSymbolShort")] });

  const tagIds = await assertTagsOwned(user.id, parsed.values.tagIds);
  if (tagIds === null) return failFields({ tagIds: [await tr("tagsNotFound")] });
  const playbookId = await ownedPlaybook(user.id, parsed.values.playbookId);
  if (playbookId === null) return failFields({ playbookId: [await tr("playbookNotFound")] });

  // Everything the fills do NOT own. `initialStopLoss` keeps its stored value
  // when the field is left blank, and only falls back to the stop for a trade
  // that never had one.
  const descriptive = {
    stopLoss: parsed.values.stopLoss?.toString() ?? null,
    initialStopLoss:
      (parsed.values.initialStopLoss ?? existing.initialStopLoss ?? parsed.values.stopLoss)?.toString() ?? null,
    takeProfit: parsed.values.takeProfit?.toString() ?? null,
    maePrice: parsed.values.maePrice?.toString() ?? null,
    mfePrice: parsed.values.mfePrice?.toString() ?? null,
    commission: (parsed.values.commission ?? 0).toString(),
    swap: (parsed.values.swap ?? 0).toString(),
    conversionRate: parsed.values.conversionRate?.toString() ?? null,
    followedPlan: parsed.values.followedPlan ?? null,
    emotion: parsed.values.emotion ?? null,
    confidence: parsed.values.confidence ?? null,
    notes: parsed.values.notes ?? null,
    tradeTags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) },
    playbookId: playbookId ?? null,
    // Checklist answers belong to the playbook they were given for.
    ...(existing.playbookId !== (playbookId ?? null) ? { ruleChecks: { deleteMany: {} } } : {}),
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
  if (!existing) return failT("tradeNotFound");

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
    return failZod(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }

  const existing = await prisma.trade.findFirst({
    where: { id: tradeId, accountId },
    include: { executions: true },
  });
  if (!existing) return failT("tradeNotFound");
  if (existing.entryMode === "R_MULTIPLE") return failT("rTradeNoFills");
  if (existing.status !== "OPEN") return failT("onlyOpenCanClose");
  if (parsed.data.closedAt.getTime() < existing.openedAt.getTime()) {
    return failFields({ closedAt: [await tr("closeBeforeOpen")] });
  }

  const fills = existing.executions.map(toFill);
  const { volumeLots: entered, exitedLots } = aggregateFills(fills);
  const open = entered.minus(exitedLots);
  const lots = parsed.data.volumeLots === undefined ? open : new Decimal(parsed.data.volumeLots);
  if (lots.gt(open)) {
    return failFields({ volumeLots: [await tr("onlyLotsOpen", { lots: open.toString() })] });
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
// closeRTrade — closing an R-mode trade: the result in R and when.
// ---------------------------------------------------------------------------

export async function closeRTrade(
  accountId: string,
  tradeId: string,
  input: { resultR: string | number; closedAt: string | Date },
): Promise<TradeResult> {
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;

  const parsed = closeRTradeSchema.safeParse(input);
  if (!parsed.success) {
    return failZod(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }

  const existing = await prisma.trade.findFirst({ where: { id: tradeId, accountId: found.account.id } });
  if (!existing) return failT("tradeNotFound");
  if (existing.entryMode !== "R_MULTIPLE" || existing.plannedRisk === null) return failT("notAnRTrade");
  if (existing.status !== "OPEN") return failT("onlyOpenCanClose");
  if (parsed.data.closedAt.getTime() < existing.openedAt.getTime()) {
    return failFields({ closedAt: [await tr("closeBeforeOpen")] });
  }

  const closed = { ...existing, status: "CLOSED" as const, closedAt: parsed.data.closedAt };
  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status: "CLOSED",
      closedAt: parsed.data.closedAt,
      resultR: parsed.data.resultR.toString(),
      ...derivedColumns(rTradeInput({ ...closed, resultR: new Prisma.Decimal(parsed.data.resultR) })),
    },
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
  if (!existing) return failT("tradeNotFound");

  const owned = await assertTagsOwned(user.id, tagIds);
  if (owned === null) return failFields({ tagIds: [await tr("tagsNotFound")] });

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
  if (!existing) return failT("tradeNotFound");

  // A duplicate is deliberately a fresh, OPEN position: same symbol,
  // direction, size and planned stop/target, opened "now" — the setup you
  // just logged is one you're about to take again, not a second copy of
  // history with a fabricated close. Discipline fields (emotion, confidence,
  // followedPlan, notes) are left blank since they describe THIS occurrence.
  const now = new Date();
  if (existing.entryMode === "R_MULTIPLE") {
    const created = await prisma.trade.create({
      data: {
        accountId,
        entryMode: "R_MULTIPLE",
        symbol: existing.symbol,
        direction: existing.direction,
        status: "OPEN",
        openedAt: now,
        plannedRisk: existing.plannedRisk,
        plannedRR: existing.plannedRR,
        volumeLots: existing.volumeLots,
        ...(derivedColumns(
          rTradeInput({
            plannedRR: existing.plannedRR,
            plannedRisk: existing.plannedRisk,
            resultR: null,
            commission: new Prisma.Decimal(0),
            swap: new Prisma.Decimal(0),
            openedAt: now,
            closedAt: null,
          }),
        ) as unknown as PlainDerivedNumbers),
        tradeTags: existing.tradeTags.length
          ? { create: existing.tradeTags.map((tt) => ({ tagId: tt.tagId })) }
          : undefined,
      },
    });
    revalidateTradeViews(created.id);
    return ok({ id: created.id });
  }
  // The CHECK constraint guarantees these on a PRICE row.
  const entryPrice = existing.entryPrice!;
  const volumeLots = existing.volumeLots!;
  const created = await prisma.trade.create({
    data: {
      accountId,
      symbol: existing.symbol,
      direction: existing.direction,
      status: "OPEN",
      openedAt: now,
      entryPrice,
      stopLoss: existing.stopLoss,
      initialStopLoss: existing.initialStopLoss ?? existing.stopLoss,
      takeProfit: existing.takeProfit,
      volumeLots,
      conversionRate: existing.conversionRate,
      tradeTags: existing.tradeTags.length
        ? { create: existing.tradeTags.map((tt) => ({ tagId: tt.tagId })) }
        : undefined,
      executions: {
        create: [{ kind: "ENTRY", executedAt: now, price: entryPrice, volumeLots }],
      },
    },
  });

  revalidateTradeViews(created.id);
  return ok({ id: created.id });
}
