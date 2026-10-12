"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { accountOrFailure } from "./guard";
import { prisma } from "@/lib/db";
import { fieldErrorsFrom, ok, type ActionResult } from "./result";
import { ACCOUNT_COOKIE } from "@/lib/active-account";
import { failZod, tr } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";

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

const blankToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const optionalPercent = z.preprocess(
  blankToUndefined,
  z.coerce.number().min(0, vmsg("zeroOrMore")).max(100, vmsg("max100")).optional(),
);

const accountSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, vmsg("labelRequired"))
    .max(80, vmsg("maxChars", { max: "80" })),
  broker: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .max(80, vmsg("maxChars", { max: "80" }))
      .optional(),
  ),
  platform: z.enum(["MT5", "MT4", "CTRADER", "OTHER"], { message: vmsg("choosePlatform") }),
  accountType: z.enum(["DEMO", "LIVE", "PROP"], { message: vmsg("chooseAccountType") }),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, vmsg("currencyCode")),
  startingBalance: z.coerce.number({ message: vmsg("enterStartingBalance") }).min(0, vmsg("zeroOrMore")),
  riskPerTradePct: optionalPercent,
  // Prop-firm challenge rules (src/lib/prop.ts). All optional.
  dailyLossLimitPct: optionalPercent,
  maxDrawdownPct: optionalPercent,
  drawdownMode: z.enum(["STATIC", "TRAILING"]).default("STATIC"),
  profitTargetPct: z.preprocess(blankToUndefined, z.coerce.number().min(0, vmsg("zeroOrMore")).max(1000).optional()),
  minTradingDays: z.preprocess(
    blankToUndefined,
    z.coerce.number().int(vmsg("wholeDays")).min(0, vmsg("zeroOrMore")).max(365).optional(),
  ),
});

export type AccountInput = z.input<typeof accountSchema>;

function ruleColumns(d: z.output<typeof accountSchema>) {
  const pct = (v: number | undefined) => (v === undefined ? null : v.toFixed(3));
  return {
    dailyLossLimitPct: pct(d.dailyLossLimitPct),
    maxDrawdownPct: pct(d.maxDrawdownPct),
    drawdownMode: d.drawdownMode,
    profitTargetPct: pct(d.profitTargetPct),
    minTradingDays: d.minTradingDays ?? null,
  };
}

export async function createAccount(input: AccountInput): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

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
      ...ruleColumns(parsed.data),
    },
  });

  revalidateAccounts();
  return ok();
}

export async function updateAccount(accountId: string, input: AccountInput): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  const found = await accountOrFailure(accountId, await tr("accountNotFound"));
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
      ...ruleColumns(parsed.data),
    },
  });

  revalidateAccounts();
  return ok();
}

// ---------------------------------------------------------------------------
// Archive / delete
// ---------------------------------------------------------------------------

export async function archiveAccount(accountId: string, archived: boolean): Promise<ActionResult> {
  const found = await accountOrFailure(accountId, await tr("accountNotFound"));
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
  const found = await accountOrFailure(accountId, await tr("accountNotFound"));
  if ("failure" in found) return found.failure;

  const tradeCount = await prisma.trade.count({ where: { accountId } });
  if (tradeCount > 0) {
    return {
      ok: false,
      formError: await tr("accountHasTrades", { count: tradeCount }),
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
  kind: z.enum(["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"], { message: vmsg("chooseKind") }),
  // Users always type a plain magnitude; the sign is applied below based on
  // `kind` so a withdrawal can never accidentally increase the balance.
  amount: z.coerce.number({ message: vmsg("enterAmount") }).refine((n) => n !== 0, vmsg("amountNonZero")),
  occurredAt: z.string().min(1, vmsg("dateRequired")),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .max(500, vmsg("maxChars", { max: "500" }))
      .optional(),
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
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  const found = await accountOrFailure(accountId, await tr("accountNotFound"));
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
  const found = await accountOrFailure(accountId, await tr("accountNotFound"));
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
  const found = await accountOrFailure(accountId, await tr("accountNotFound"));
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
