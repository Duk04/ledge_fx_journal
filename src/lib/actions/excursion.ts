"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { excursionFromBars } from "@/lib/metrics/excursion";
import { accountOrFailure } from "./guard";
import { fail, ok, type ActionResult } from "./result";

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
  if (!trade) return fail("Trade not found.");
  if (trade.status !== "CLOSED" || !trade.closedAt || !trade.exitPrice) {
    return fail("Only a closed trade has a complete price path to measure.");
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
    return fail(
      `No M1 candles for ${trade.symbol} cover this trade. Import them under Backtest → Data, or enter the prices by hand when editing.`,
    );
  }

  await prisma.trade.update({
    where: { id: trade.id },
    data: { maePrice: e.maePrice.toString(), mfePrice: e.mfePrice.toString() },
  });
  revalidatePath(`/trades/${trade.id}`);
  return ok({ maePrice: e.maePrice.toString(), mfePrice: e.mfePrice.toString(), barsUsed: e.barsUsed });
}
