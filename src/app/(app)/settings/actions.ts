"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { derivedColumns, tradeInput } from "@/lib/trade-service";
import { seedInstruments } from "@/lib/instruments";
import { IANA_TIMEZONES } from "@/components/settings/timezones";

/**
 * Server actions for the Profile / Instruments / Data tabs. Tags have their
 * own file (`src/lib/actions/tags.ts`) since Tag CRUD is substantial enough
 * to stand on its own; everything else in Settings lives here, colocated
 * with the route that's its only caller.
 */

export interface ActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string[]>;
  formError?: string;
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(120, "Keep it under 120 characters.").optional(),
  ),
  timezone: z.string().min(1, "Choose a timezone."),
});

export async function updateProfile(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  if (!IANA_TIMEZONES.some((tz) => tz.value === parsed.data.timezone)) {
    return { ok: false, fieldErrors: { timezone: ["Choose a timezone from the list."] } };
  }

  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { name: parsed.data.name ?? null, timezone: parsed.data.timezone },
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

const instrumentSchema = z.object({
  pipSize: z.coerce.number({ message: "Enter a pip size." }).positive("Must be greater than zero."),
  contractSize: z.coerce.number({ message: "Enter a contract size." }).positive("Must be greater than zero."),
  digits: z.coerce.number({ message: "Enter a digit count." }).int().min(0).max(8),
  quoteCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD."),
});

export async function updateInstrument(
  symbol: string,
  input: z.input<typeof instrumentSchema>,
): Promise<ActionResult> {
  const parsed = instrumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  await requireUser();

  const existing = await prisma.instrument.findUnique({ where: { symbol } });
  if (!existing) return { ok: false, formError: "Instrument not found." };

  await prisma.instrument.update({
    where: { symbol },
    data: {
      pipSize: parsed.data.pipSize.toString(),
      contractSize: parsed.data.contractSize.toString(),
      digits: parsed.data.digits,
      quoteCurrency: parsed.data.quoteCurrency,
    },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Restores every instrument's contract fields from `src/lib/instruments.ts`. */
export async function resetInstrumentsToDefaults(): Promise<ActionResult> {
  await requireUser();

  for (const inst of seedInstruments) {
    await prisma.instrument
      .update({
        where: { symbol: inst.symbol },
        data: {
          displayName: inst.displayName,
          pipSize: inst.pipSize,
          contractSize: inst.contractSize,
          digits: inst.digits,
          baseCurrency: inst.baseCurrency,
          quoteCurrency: inst.quoteCurrency,
          assetClass: inst.assetClass,
          isActive: true,
        },
      })
      // A symbol removed from the reference table by hand shouldn't abort
      // the whole reset for every other instrument.
      .catch(() => null);
  }

  revalidatePath("/settings");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Data: recompute derived trade columns
// ---------------------------------------------------------------------------

/**
 * Recomputes and stores netPnl/grossPnl/pips/rMultiple/riskAmount/
 * holdingMinutes/marketSession for every trade across the user's accounts,
 * using the exact same `derivedColumns()` logic a backfill script would.
 * See docs/JOURNAL.md for why this exists as a button rather than only a
 * one-off script.
 */
export async function recomputeDerivedColumns(): Promise<ActionResult & { updated?: number }> {
  const user = await requireUser();

  const accounts = await prisma.tradingAccount.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);
  if (accountIds.length === 0) return { ok: true, updated: 0 };

  const trades = await prisma.trade.findMany({
    where: { accountId: { in: accountIds } },
    include: { instrument: true, account: { select: { currency: true } } },
  });

  let updated = 0;
  for (const trade of trades) {
    const input = tradeInput(trade, trade.instrument, trade.account.currency);
    await prisma.trade.update({ where: { id: trade.id }, data: derivedColumns(input) });
    updated++;
  }

  revalidatePath("/settings");
  revalidatePath("/journal");
  revalidatePath("/accounts");
  revalidatePath("/", "layout");
  return { ok: true, updated };
}
