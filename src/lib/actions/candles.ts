"use server";

import { revalidatePath } from "next/cache";
import type { CandleSource, Timeframe } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, ok, type ActionResult } from "./result";
import { ForbiddenError, requireOwner, requireUser } from "@/lib/session";
import { parseCandleCsv } from "@/lib/candles/parse";
import { upsertCandles } from "@/lib/candles/upsert";

/**
 * Candle imports and deletes. Same result-object convention as every other
 * action module (see accounts.ts) — return `{ ok, formError? }` rather than
 * throwing, since a server action wired to a form has nothing to catch a
 * rejected promise with.
 */

/**
 * What a successful import reports back.
 *
 * This was two hand-written interfaces, `ImportSuccess` ({ ok: true, ...this })
 * and `ImportFailure` ({ ok: false, formError }) — which is `ActionResult<T>`
 * spelled out longhand. Both names are still exported, as aliases, so the
 * import panel that consumes them is untouched.
 */
export interface ImportReport {
  format: "MT5" | "GENERIC";
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export type ImportSuccess = { ok: true } & ImportReport;
export type ImportFailure = { ok: false; formError: string };

const TIMEFRAMES: readonly Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function revalidateDataPage() {
  revalidatePath("/backtest/data");
}

/**
 * `formData` fields: `file` (the CSV), `symbol`, `timeframe`,
 * `tzOffsetMinutes`.
 *
 * NOTE ON UPLOAD SIZE: Next.js Server Actions cap the request body at 1MB by
 * default (`experimental.serverActions.bodySizeLimit` in next.config.ts).
 * The 25MB check below is this module's own business rule, but it can only
 * ever be reached once that framework limit is raised to allow it through —
 * see docs/BACKTEST-DATA.md.
 */
export async function importCandles(formData: FormData): Promise<ActionResult<ImportReport>> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("Choose a CSV file to import.");
  if (file.size === 0) return fail("That file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      formError: `That file is too large — the limit is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
    };
  }

  const symbol = String(formData.get("symbol") ?? "")
    .trim()
    .toUpperCase();
  if (!symbol) return fail("Choose a symbol.");

  const timeframeRaw = String(formData.get("timeframe") ?? "");
  if (!TIMEFRAMES.includes(timeframeRaw as Timeframe)) return fail("Choose a timeframe.");
  const timeframe = timeframeRaw as Timeframe;

  const tzOffsetMinutes = Number(formData.get("tzOffsetMinutes"));
  if (!Number.isFinite(tzOffsetMinutes)) {
    return fail("A timezone offset is required — see the hint next to that field.");
  }

  const instrument = await prisma.instrument.findUnique({ where: { symbol } });
  if (!instrument) return { ok: false, formError: `"${symbol}" is not a known instrument.` };

  const text = await file.text();
  const parsed = parseCandleCsv(text, { tzOffsetMinutes });

  if (parsed.rows.length === 0) {
    return {
      ok: false,
      formError: parsed.warnings[0] ?? "No valid rows were found in that file.",
    };
  }

  const source: CandleSource = parsed.format === "MT5" ? "MT5_CSV" : "GENERIC_CSV";
  const { inserted, updated } = await upsertCandles(symbol, timeframe, source, parsed.rows);

  const fromTs = new Date(parsed.rows[0].ts);
  const toTs = new Date(parsed.rows[parsed.rows.length - 1].ts);

  await prisma.candleImport.create({
    data: {
      userId: user.id,
      symbol,
      timeframe,
      source,
      fileName: file.name || null,
      rowCount: parsed.rows.length,
      fromTs,
      toTs,
      tzOffsetMinutes,
    },
  });

  revalidateDataPage();

  return ok({
    format: parsed.format,
    inserted,
    updated,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
  });
}

/**
 * Deletes stored candles for a symbol/timeframe, optionally scoped to a range.
 *
 * OWNER ONLY. Candles aren't user-owned data (see the note in
 * lib/queries/candles.ts), and the check used to be nothing more than "is
 * someone signed in" — which, once registration opened to the public, meant
 * any stranger could delete the market data every other user backtests
 * against. Shared data means shared integrity, so writes are gated even
 * though reads are not.
 *
 * The confirm dialog in the UI is not what made this safe: a server action is
 * reachable by POST regardless of what the interface offers. It is a courtesy
 * to the owner, not a control.
 *
 * `CandleImport` records who supplied which range, so an owner can see what
 * they are about to remove.
 */
export async function deleteCandles(input: {
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
}): Promise<ActionResult> {
  try {
    await requireOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return fail("Only the instance owner can delete shared market data.");
    }
    throw err;
  }

  const { symbol, timeframe, from, to } = input;
  if (!symbol || !TIMEFRAMES.includes(timeframe)) {
    return fail("Symbol and timeframe are required.");
  }

  const tsFilter: { gte?: Date; lte?: Date } = {};
  if (from) tsFilter.gte = from;
  if (to) tsFilter.lte = to;

  await prisma.candle.deleteMany({
    where: { symbol, timeframe, ...(from || to ? { ts: tsFilter } : {}) },
  });

  revalidateDataPage();
  return ok();
}
