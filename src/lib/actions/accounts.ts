"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { accountOrFailure } from "./guard";
import { prisma } from "@/lib/db";
import { failFields, fieldErrorsFrom, ok, type ActionResult } from "./result";
import { ACCOUNT_COOKIE } from "@/lib/active-account";

/** `requireAccountAccess` throws NotFoundError for a missing/foreign account —
 * actions must never throw at a form, so every write funnels the lookup
 * through this instead. */
function revalidateAccounts() {
  revalidatePath("/accounts");
  // Equity/label/type shown in the account switcher & rail live in the shared layout.
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(80, "Keep it under 80 characters."),
  broker: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(80, "Keep it under 80 characters.").optional(),
  ),
  platform: z.enum(["MT5", "MT4", "CTRADER", "OTHER"], { message: "Choose a platform." }),
  accountType: z.enum(["DEMO", "LIVE", "PROP"], { message: "Choose an account type." }),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD."),
  startingBalance: z.coerce.number({ message: "Enter a starting balance." }).min(0, "Must be zero or more."),
  riskPerTradePct: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().min(0, "Must be zero or more.").max(100, "Must be 100 or less.").optional(),
  ),
});

export type AccountInput = z.input<typeof accountSchema>;

export async function createAccount(input: AccountInput): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return failFields(fieldErrorsFrom(parsed.error));

  const user = await requireUser();

  await prisma.tradingAccount.create({
    data: {
      userId: user.id,
      label: parsed.data.label,
      broker: parsed.data.broker ?? null,
      platform: parsed.data.platform,
      accountType: parsed.data.accountType,
      currency: parsed.data.currency,
      startingBalance: parsed.data.startingBalance.toFixed(2),
      riskPerTradePct: parsed.data.riskPerTradePct !== undefined ? parsed.data.riskPerTradePct.toFixed(3) : null,
    },
  });

  revalidateAccounts();
  return ok();
}

export async function updateAccount(accountId: string, input: AccountInput): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return failFields(fieldErrorsFrom(parsed.error));

  const found = await accountOrFailure(accountId, "That account was not found.");
  if ("failure" in found) return found.failure;

  await prisma.tradingAccount.update({
    where: { id: accountId },
    data: {
      label: parsed.data.label,
      broker: parsed.data.broker ?? null,
      platform: parsed.data.platform,
      accountType: parsed.data.accountType,
      currency: parsed.data.currency,
      startingBalance: parsed.data.startingBalance.toFixed(2),
      riskPerTradePct: parsed.data.riskPerTradePct !== undefined ? parsed.data.riskPerTradePct.toFixed(3) : null,
    },
  });

  revalidateAccounts();
  return ok();
}

// ---------------------------------------------------------------------------
// Archive / delete
// ---------------------------------------------------------------------------

export async function archiveAccount(accountId: string, archived: boolean): Promise<ActionResult> {
  const found = await accountOrFailure(accountId, "That account was not found.");
  if ("failure" in found) return found.failure;

  await prisma.tradingAccount.update({ where: { id: accountId }, data: { isArchived: archived } });
  revalidateAccounts();
  return ok();
}

/**
 * Refuses to delete an account that still has trades — offering archive
 * instead — rather than silently cascading the delete through potentially
 * hundreds of trade rows. See docs/JOURNAL.md for the rationale.
 */
export async function deleteAccount(accountId: string): Promise<ActionResult> {
  const found = await accountOrFailure(accountId, "That account was not found.");
  if ("failure" in found) return found.failure;

  const tradeCount = await prisma.trade.count({ where: { accountId } });
  if (tradeCount > 0) {
    return {
      ok: false,
      formError: `This account still has ${tradeCount} trade${tradeCount === 1 ? "" : "s"} — archive it instead, or delete its trades first.`,
    };
  }

  await prisma.tradingAccount.delete({ where: { id: accountId } });
  revalidateAccounts();
  return ok();
}

// ---------------------------------------------------------------------------
// Balance events
// ---------------------------------------------------------------------------

const balanceEventSchema = z.object({
  kind: z.enum(["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"], { message: "Choose a kind." }),
  // Users always type a plain magnitude; the sign is applied below based on
  // `kind` so a withdrawal can never accidentally increase the balance.
  amount: z.coerce.number({ message: "Enter an amount." }).refine((n) => n !== 0, "Amount can't be zero."),
  occurredAt: z.string().min(1, "Date is required."),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(500, "Keep it under 500 characters.").optional(),
  ),
});

export type BalanceEventInput = z.input<typeof balanceEventSchema>;

/**
 * `amount` is stored SIGNED per the contract in src/lib/metrics/types.ts
 * (positive increases balance, negative decreases it) so the shared
 * `equityCurve`/`maxDrawdown` functions read it correctly: DEPOSIT and
 * ADJUSTMENT keep the sign the user enters (an adjustment can go either
 * way), WITHDRAWAL is always stored negative regardless of what was typed.
 */
export async function addBalanceEvent(accountId: string, input: BalanceEventInput): Promise<ActionResult> {
  const parsed = balanceEventSchema.safeParse(input);
  if (!parsed.success) return failFields(fieldErrorsFrom(parsed.error));

  const found = await accountOrFailure(accountId, "That account was not found.");
  if ("failure" in found) return found.failure;

  const magnitude = Math.abs(parsed.data.amount);
  const signedAmount =
    parsed.data.kind === "WITHDRAWAL" ? -magnitude : parsed.data.kind === "DEPOSIT" ? magnitude : parsed.data.amount;

  await prisma.balanceEvent.create({
    data: {
      accountId,
      kind: parsed.data.kind,
      amount: signedAmount.toFixed(2),
      occurredAt: new Date(`${parsed.data.occurredAt}T00:00:00.000Z`),
      note: parsed.data.note ?? null,
    },
  });

  revalidateAccounts();
  return ok();
}

export async function deleteBalanceEvent(accountId: string, eventId: string): Promise<ActionResult> {
  const found = await accountOrFailure(accountId, "That account was not found.");
  if ("failure" in found) return found.failure;

  await prisma.balanceEvent.deleteMany({ where: { id: eventId, accountId } });
  revalidateAccounts();
  return ok();
}

// ---------------------------------------------------------------------------
// Active account
// ---------------------------------------------------------------------------

/** Sets the `ledger.account` cookie the whole app reads to scope trades/journal. */
export async function setActiveAccount(accountId: string): Promise<ActionResult> {
  const found = await accountOrFailure(accountId, "That account was not found.");
  if ("failure" in found) return found.failure;

  const jar = await cookies();
  jar.set(ACCOUNT_COOKIE, accountId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  revalidateAccounts();
  return ok();
}
