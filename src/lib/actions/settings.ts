"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { failFields, fieldErrorsFrom, ok, type ActionResult } from "./result";
import { ownerOrFailure } from "./guard";
import { recomputeDerived } from "./recompute";
import { seedInstruments } from "@/lib/instruments";
import { IANA_TIMEZONES } from "@/lib/timezones";
import { failT, failZod, tr } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";

/**
 * Server actions for the Profile, Instruments and Data tabs: the profile
 * fields, the shared instrument specs, and the derived-column recompute. The
 * rest of Settings has its own module — tags, notifications, locale, restore
 * and account deletion. This file used to sit under `app/(app)/settings/`,
 * "colocated with its only caller", which put a Prisma caller in the app
 * layer and had components importing back from `@/app` (AGENTS.md, "Layers").
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .max(120, vmsg("maxChars", { max: "120" }))
      .optional(),
  ),
  timezone: z.string().min(1, vmsg("chooseTimezone")),
});

export async function updateProfile(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  if (!IANA_TIMEZONES.some((tz) => tz.value === parsed.data.timezone)) {
    return failFields({ timezone: [await tr("chooseTimezoneFromList")] });
  }

  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { name: parsed.data.name ?? null, timezone: parsed.data.timezone },
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return ok();
}

// ---------------------------------------------------------------------------
// Instruments — OWNER ONLY
//
// `Instrument` is a single shared table with no `userId`: one row per symbol,
// holding the pipSize, contractSize, digits and quoteCurrency that
// `derivedColumns()` and `resolveConversion()` use to compute P&L, pips and R
// for EVERY user's trades. Editing a row therefore silently rewrites other
// people's numbers — a wrong contractSize is off by orders of magnitude, and
// nothing in the journal would look broken, just wrong.
//
// These two actions used to require only that someone be signed in. Under
// open registration that is any stranger.
//
// The honest cost of gating them: a member whose broker really does use a
// different pip size can no longer correct it themselves. That is a genuine
// regression, not a non-issue, and the fix is a per-user override table
// rather than letting everyone write the shared row. Until then the
// Instruments tab renders read-only for members and says why, instead of
// offering a control that 403s on submit.
// ---------------------------------------------------------------------------

const instrumentSchema = z.object({
  pipSize: z.coerce.number({ message: vmsg("enterPipSize") }).positive(vmsg("greaterThanZero")),
  contractSize: z.coerce.number({ message: vmsg("enterContractSize") }).positive(vmsg("greaterThanZero")),
  digits: z.coerce
    .number({ message: vmsg("enterDigits") })
    .int()
    .min(0)
    .max(8),
  quoteCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, vmsg("currencyCode")),
});

export async function updateInstrument(symbol: string, input: z.input<typeof instrumentSchema>): Promise<ActionResult> {
  const parsed = instrumentSchema.safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));

  const owner = await ownerOrFailure("ownerOnlyInstruments");
  if ("failure" in owner) return owner.failure;

  const existing = await prisma.instrument.findUnique({ where: { symbol } });
  if (!existing) return failT("instrumentNotFound");

  await prisma.instrument.update({
    where: { symbol },
    data: {
      pipSize: parsed.data.pipSize.toString(),
      contractSize: parsed.data.contractSize.toString(),
      digits: parsed.data.digits,
      quoteCurrency: parsed.data.quoteCurrency,
    },
  });

  // The instrument is shared, so every user's trades on it carry numbers
  // derived from the old spec. The owner is the one who changed it; their
  // request pays for bringing the stored P&L, pips and R back in line.
  await recomputeDerived({ symbol });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return ok();
}

/** Restores every instrument's contract fields from `src/lib/instruments.ts`. */
export async function resetInstrumentsToDefaults(): Promise<ActionResult> {
  const owner = await ownerOrFailure("ownerOnlyResetInstruments");
  if ("failure" in owner) return owner.failure;

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
  await recomputeDerived({ symbol: { in: seedInstruments.map((i) => i.symbol) } });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return ok();
}

// ---------------------------------------------------------------------------
// Data: recompute derived trade columns
// ---------------------------------------------------------------------------

/**
 * Recomputes the stored netPnl/grossPnl/pips/rMultiple/riskAmount/
 * holdingMinutes/marketSession of every trade across the user's accounts,
 * with the same `derivedColumns()` the backfill script uses — in chunks, and
 * never on BACKTEST trades (actions/recompute.ts says why). See
 * docs/JOURNAL.md for why this exists as a button rather than only a script.
 */
export async function recomputeDerivedColumns(): Promise<ActionResult<{ updated: number }>> {
  const user = await requireUser();

  const { scanned } = await recomputeDerived({ account: { userId: user.id } });

  revalidatePath("/settings");
  revalidatePath("/journal");
  revalidatePath("/accounts");
  revalidatePath("/", "layout");
  return { ok: true, updated: scanned };
}
