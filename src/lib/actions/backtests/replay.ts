"use server";

import { simpleExecutionsCreate } from "../fills-store";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { classifyOutcome } from "@/lib/metrics";
import type { TradeRow } from "@/lib/metrics/types";
import { revalidatePath } from "next/cache";
import { type Prisma, type Timeframe } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fieldErrorsFrom, ok, type ActionResult } from "../result";
import { requireUser } from "@/lib/session";
import { getBars } from "@/lib/queries/candles";
import { toRunStats } from "@/lib/queries/backtests";
import { summarize, equityCurve, maxDrawdown } from "@/lib/metrics";
import { toJournalTrade } from "@/lib/backtest";
import type { SimTrade } from "@/lib/backtest/types";
import { simTradeSchema } from "@/lib/backtest/sim-trade-schema";
import { BACKTEST_ACCOUNT_CURRENCY } from "@/lib/backtest/run-setup";
import { MAX_BARS, MIN_BARS, TIMEFRAMES, fillSchema, labelFor } from "./shared";
import { failT, failZod, tr } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";

/**
 * Manual replay: stepping through historical bars and placing orders by hand.
 *
 * `recordReplayTrade` is the older of the two client-computes-the-trade
 * paths, and the precedent `recordStrategyRun` follows — the browser works
 * out each fill using the same primitives the engine uses, and this action
 * checks ownership and writes the row.
 */

const createReplaySchema = z
  .object({
    symbol: z.string().trim().min(1, vmsg("chooseSymbol")),
    timeframe: z.enum(TIMEFRAMES, { message: vmsg("chooseTimeframe") }),
    from: z.coerce.date({ message: vmsg("chooseStart") }),
    to: z.coerce.date({ message: vmsg("chooseEnd") }),
    initialBalance: z.coerce.number().positive(vmsg("greaterThanZero")),
  })
  .extend(fillSchema.shape)
  .refine((v) => v.to > v.from, { message: vmsg("endAfterStart"), path: ["to"] });

export type CreateReplayInput = z.input<typeof createReplaySchema>;

/**
 * Creates the BACKTEST account + BacktestRun a replay session writes into.
 * No trades are simulated here — replay is driven bar-by-bar in the browser
 * (see components/backtest/replay); this just opens the ledger it writes to.
 */
export async function createReplayRun(input: CreateReplayInput): Promise<ActionResult<{ runId: string }>> {
  const parsed = createReplaySchema.safeParse(input);
  if (!parsed.success) return failZod(fieldErrorsFrom(parsed.error));
  const v = parsed.data;

  const user = await requireUser();

  const { bars } = await getBars({ symbol: v.symbol, timeframe: v.timeframe as Timeframe, from: v.from, to: v.to });
  if (bars.length < MIN_BARS) {
    return {
      ok: false,
      formError: await tr("replayTooFewBars", {
        count: String(bars.length),
        symbol: v.symbol,
        timeframe: v.timeframe,
        min: String(MIN_BARS),
      }),
    };
  }
  if (bars.length > MAX_BARS) {
    return {
      ok: false,
      formError: await tr("replayTooManyBars", {
        count: bars.length.toLocaleString("en-US"),
        max: MAX_BARS.toLocaleString("en-US"),
      }),
    };
  }

  const label = labelFor("Replay", v.symbol, v.timeframe, v.from);

  const runId = await prisma.$transaction(async (tx) => {
    const account = await tx.tradingAccount.create({
      data: {
        userId: user.id,
        label,
        platform: "OTHER",
        accountType: "BACKTEST",
        currency: BACKTEST_ACCOUNT_CURRENCY,
        startingBalance: v.initialBalance.toFixed(2),
      },
    });

    const run = await tx.backtestRun.create({
      data: {
        userId: user.id,
        accountId: account.id,
        kind: "REPLAY",
        status: "DRAFT",
        label,
        symbol: v.symbol,
        timeframe: v.timeframe as Timeframe,
        fromTs: v.from,
        toTs: v.to,
        initialBalance: v.initialBalance.toFixed(2),
        spreadPoints: v.spreadPoints,
        commissionPerLot: v.commissionPerLot.toFixed(2),
        slippagePoints: v.slippagePoints,
        pessimisticFills: v.pessimisticFills,
        startedAt: new Date(),
      },
    });

    return run.id;
  });

  revalidatePath("/backtest");
  return { ok: true, runId };
}

/**
 * Persists one trade the replay UI just closed. The client computed `trade`
 * itself, bar by bar, using the exact same `entryPrice`/`exitOnBar`/
 * `closeAtPrice` functions the engine uses (see
 * components/backtest/replay/use-replay-engine.ts) — this action's job is
 * only to check ownership and write the row, via the same `toJournalTrade`
 * boundary a strategy run uses. After each insert the run's stored stats are
 * refreshed from every trade recorded so far, so the run list and results
 * page never have to distinguish "still replaying" from "finished".
 */
export async function recordReplayTrade(runId: string, trade: SimTrade): Promise<ActionResult> {
  const parsed = simTradeSchema.safeParse(trade);
  if (!parsed.success) return failT("replayTradeShape");

  const user = await requireUser();
  const run = await prisma.backtestRun.findFirst({ where: { id: runId, userId: user.id } });
  if (!run) return failT("replayRunNotFound");
  if (run.kind !== "REPLAY") return failT("notAReplay");

  const journalInput = toJournalTrade(parsed.data, {
    accountId: run.accountId,
    symbol: run.symbol,
    backtestRunId: run.id,
  });

  await prisma.$transaction(async (tx) => {
    await tx.trade.create({
      data: {
        accountId: journalInput.accountId,
        symbol: journalInput.symbol,
        direction: journalInput.direction,
        status: journalInput.status,
        openedAt: journalInput.openedAt,
        closedAt: journalInput.closedAt,
        entryPrice: journalInput.entryPrice,
        exitPrice: journalInput.exitPrice,
        stopLoss: journalInput.stopLoss,
        initialStopLoss: journalInput.stopLoss,
        takeProfit: journalInput.takeProfit,
        volumeLots: journalInput.volumeLots,
        commission: journalInput.commission,
        grossPnl: journalInput.grossPnl,
        netPnl: journalInput.netPnl,
        pips: journalInput.pips,
        rMultiple: journalInput.rMultiple,
        riskAmount: journalInput.riskAmount,
        holdingMinutes: journalInput.holdingMinutes,
        marketSession: journalInput.marketSession,
        backtestRunId: journalInput.backtestRunId,
        notes: journalInput.notes,
        executions: { create: simpleExecutionsCreate(journalInput) },
      },
    });

    const allTrades = await tx.trade.findMany({ where: { backtestRunId: run.id } });
    const rows: TradeRow[] = allTrades.map((t) => ({
      netPnl: t.netPnl ? new Decimal(t.netPnl.toString()) : null,
      rMultiple: t.rMultiple ? new Decimal(t.rMultiple.toString()) : null,
      outcome: classifyOutcome(t.netPnl ? new Decimal(t.netPnl.toString()) : null, "CLOSED"),
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      holdingMinutes: t.holdingMinutes,
    }));
    const stats = toRunStats(summarize(rows), allTrades.length);
    const curve = equityCurve(rows, run.initialBalance.toString());
    const dd = maxDrawdown(curve);
    stats.maxDrawdownAmount = dd ? dd.amount.toNumber() : null;
    stats.maxDrawdownPct = dd ? dd.pct.toNumber() : null;
    stats.barsProcessed = allTrades.length;

    await tx.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "DONE",
        finishedAt: new Date(),
        stats: stats as unknown as Prisma.InputJsonValue,
      },
    });
  });

  revalidatePath("/backtest");
  revalidatePath(`/backtest/runs/${run.id}`);
  return ok();
}
