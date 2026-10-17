"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { excursionFromBars } from "@/lib/metrics/excursion";
import { accountOrFailure } from "./guard";
import { fail, ok, type ActionResult } from "./result";
import { failT, tr } from "@/i18n/server-t";

/**
 * MAE/MFE for a closed trade from stored M1 candles (the shared Candle
 * table — reads are unscoped, see src/lib/queries/candles.ts). Refuses
 * rather than guessing when the bars don't cover the holding period.
 */
export async function fillExcursionFromCandles(
  accountId: string,
  tradeId: string,
): Promise<ActionResult<{ maePrice: string; mfePrice: string; barsUsed: number }>> {
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;

  const trade = await prisma.trade.findFirst({ where: { id: tradeId, accountId: found.account.id } });
  if (!trade) return failT("tradeNotFound");
  // An R-mode trade has no entry or exit price to measure excursion from.
  if (trade.status !== "CLOSED" || !trade.closedAt || !trade.exitPrice || !trade.entryPrice) {
    return failT("excursionNeedsClosed");
  }

  const bars = await prisma.candle.findMany({
    where: {
      symbol: trade.symbol,
      timeframe: "M1",
      ts: { gte: new Date(trade.openedAt.getTime() - 60_000), lte: trade.closedAt },
    },
    select: { ts: true, high: true, low: true },
    orderBy: { ts: "asc" },
  });

  const e = excursionFromBars(
    {
      direction: trade.direction,
      entryPrice: trade.entryPrice.toString(),
      exitPrice: trade.exitPrice.toString(),
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
    },
    bars.map((b) => ({ ts: b.ts, high: b.high.toString(), low: b.low.toString() })),
  );
  if (!e) {
    return fail(await tr("excursionNoCandles", { symbol: trade.symbol }));
  }

  await prisma.trade.update({
    where: { id: trade.id },
    data: { maePrice: e.maePrice.toString(), mfePrice: e.mfePrice.toString() },
  });
  revalidatePath(`/trades/${trade.id}`);
  return ok({ maePrice: e.maePrice.toString(), mfePrice: e.mfePrice.toString(), barsUsed: e.barsUsed });
}
