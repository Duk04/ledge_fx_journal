"use server";

import { revalidatePath } from "next/cache";
import type { Timeframe } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ForbiddenError, requireOwner } from "@/lib/session";
import {
  MAX_DOWNLOAD_BARS,
  OANDA_INSTRUMENTS,
  OandaError,
  estimatedBars,
  fetchOandaCandles,
} from "@/lib/candles/oanda";
import { insertMissingCandles } from "@/lib/candles/upsert";
import { failT, tr } from "@/i18n/server-t";
import { fail, ok, type ActionResult } from "./result";

const TIMEFRAMES: readonly Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DownloadReport {
  fetched: number;
  inserted: number;
  /** Bars already stored, left untouched. */
  existing: number;
}

/**
 * Fills a symbol/timeframe/date range from OANDA (lib/candles/oanda.ts).
 *
 * OWNER ONLY, like every write to the shared candle table (AGENTS.md).
 * INSERT ONLY: bars already stored are never replaced, so a download cannot
 * overwrite an MT5 import someone made on purpose; it only fills gaps.
 * `from`/`to` are calendar dates in UTC, `to` inclusive.
 */
export async function downloadCandles(input: {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
}): Promise<ActionResult<DownloadReport>> {
  try {
    await requireOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) return failT("ownerOnlyDownload");
    throw err;
  }
  const token = env.OANDA_API_TOKEN;
  if (!token) return failT("oandaNotConfigured");

  const symbol = String(input.symbol ?? "")
    .trim()
    .toUpperCase();
  const instrument = await prisma.instrument.findUnique({ where: { symbol }, select: { digits: true } });
  if (!instrument || !OANDA_INSTRUMENTS[symbol]) return failT("notDownloadable", { symbol: symbol || "?" });
  if (!TIMEFRAMES.includes(input.timeframe as Timeframe)) return failT("chooseTimeframe");
  const timeframe = input.timeframe as Timeframe;
  if (!DATE.test(input.from) || !DATE.test(input.to)) return failT("invalidDate");

  const from = new Date(`${input.from}T00:00:00.000Z`);
  const toInclusive = new Date(`${input.to}T00:00:00.000Z`);
  const to = new Date(Math.min(toInclusive.getTime() + 86_400_000, Date.now()));
  if (!(from.getTime() < to.getTime())) return failT("downloadRange");
  if (estimatedBars(timeframe, from, to) > MAX_DOWNLOAD_BARS) {
    return failT("downloadTooLarge", { max: MAX_DOWNLOAD_BARS.toLocaleString("en-US") });
  }

  let bars;
  try {
    bars = await fetchOandaCandles({
      symbol,
      timeframe,
      from,
      to,
      pointSize: 10 ** -instrument.digits,
      token,
      environment: env.OANDA_ENVIRONMENT,
    });
  } catch (err) {
    if (err instanceof OandaError) return fail(await tr("oandaFailed", { message: err.message }));
    throw err;
  }
  if (bars.length === 0) return failT("downloadEmpty");

  const { inserted, existing } = await insertMissingCandles(symbol, timeframe, "API", bars);
  const user = await requireOwner();
  await prisma.candleImport.create({
    data: {
      userId: user.id,
      symbol,
      timeframe,
      source: "API",
      fileName: "OANDA",
      rowCount: bars.length,
      fromTs: new Date(bars[0].ts),
      toTs: new Date(bars[bars.length - 1].ts),
    },
  });

  revalidatePath("/backtest/data");
  revalidatePath("/backtest/replay");
  return ok({ fetched: bars.length, inserted, existing });
}
