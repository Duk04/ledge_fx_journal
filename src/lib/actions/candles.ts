"use server";

import { revalidatePath } from "next/cache";
import type { CandleSource, Timeframe } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseCandleCsv } from "@/lib/candles/parse";
import { upsertCandles } from "@/lib/candles/upsert";

/**
 * Candle imports and deletes. Same result-object convention as every other
 * action module (see accounts.ts) — return `{ ok, formError? }` rather than
 * throwing, since a server action wired to a form has nothing to catch a
 * rejected promise with.
 */

export interface ActionResult {
  ok: boolean;
  formError?: string;
}

export interface ImportSuccess {
  ok: true;
  format: "MT5" | "GENERIC";
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export interface ImportFailure {
  ok: false;
  formError: string;
}

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
export async function importCandles(formData: FormData): Promise<ImportSuccess | ImportFailure> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, formError: "Choose a CSV file to import." };
  if (file.size === 0) return { ok: false, formError: "That file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      formError: `That file is too large — the limit is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
    };
  }

  const symbol = String(formData.get("symbol") ?? "")
    .trim()
    .toUpperCase();
  if (!symbol) return { ok: false, formError: "Choose a symbol." };

  const timeframeRaw = String(formData.get("timeframe") ?? "");
  if (!TIMEFRAMES.includes(timeframeRaw as Timeframe)) return { ok: false, formError: "Choose a timeframe." };
  const timeframe = timeframeRaw as Timeframe;

  const tzOffsetMinutes = Number(formData.get("tzOffsetMinutes"));
  if (!Number.isFinite(tzOffsetMinutes)) {
    return { ok: false, formError: "A timezone offset is required — see the hint next to that field." };
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

  return {
    ok: true,
    format: parsed.format,
    inserted,
    updated,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
  };
}

/**
 * Deletes stored candles for a symbol/timeframe, optionally scoped to a
 * range. Candles aren't user-owned data (see the note in
 * lib/queries/candles.ts) so the only check here is that someone is signed
 * in — the UI drives this from an explicit confirm dialog rather than
 * exposing it as a casual one-click action.
 */
export async function deleteCandles(input: {
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
}): Promise<ActionResult> {
  await requireUser();

  const { symbol, timeframe, from, to } = input;
  if (!symbol || !TIMEFRAMES.includes(timeframe)) {
    return { ok: false, formError: "Symbol and timeframe are required." };
  }

  const tsFilter: { gte?: Date; lte?: Date } = {};
  if (from) tsFilter.gte = from;
  if (to) tsFilter.lte = to;

  await prisma.candle.deleteMany({
    where: { symbol, timeframe, ...(from || to ? { ts: tsFilter } : {}) },
  });

  revalidateDataPage();
  return { ok: true };
}
