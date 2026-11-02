import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { derivedColumns, derivedColumnsDiffer, tradeInput } from "@/lib/trade-service";

/**
 * Re-derives the stored analytics columns (lib/trade-service.ts,
 * `derivedColumns`) for the trades matching `where` — the in-app counterpart
 * of `scripts/backfill-metrics.ts`. Called when something a stored number
 * depends on changes outside the trade itself: the Settings "Recompute"
 * button, an account's currency, an instrument's pip or contract size.
 *
 * In chunks, each written in one transaction, and only the rows whose numbers
 * actually moved: the old button loaded every trade at once and issued one
 * UPDATE per row with no transaction, which at a few thousand trades outlives
 * a serverless function's time limit partway through.
 *
 * BACKTEST trades are never touched. A strategy run converts its P&L at one
 * rate for the whole run (lib/backtest/run-setup.ts) and stores the run's
 * stats beside them; re-deriving them per trade would change their P&L and
 * leave `BacktestRun.stats` disagreeing with its own trades.
 *
 * Not a "use server" module: it trusts its caller to have authorized the
 * scope of `where` (AGENTS.md, "Server actions").
 */
export async function recomputeDerived(where: Prisma.TradeWhereInput): Promise<{ scanned: number; updated: number }> {
  const scoped: Prisma.TradeWhereInput = { AND: [where, { account: { accountType: { not: "BACKTEST" } } }] };
  let scanned = 0;
  let updated = 0;
  let cursor: string | undefined;

  for (;;) {
    const trades = await prisma.trade.findMany({
      where: scoped,
      include: { instrument: true, account: { select: { currency: true } } },
      orderBy: { id: "asc" },
      take: CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (trades.length === 0) break;

    const writes = trades.flatMap((trade) => {
      const next = derivedColumns(tradeInput(trade, trade.instrument, trade.account.currency));
      return derivedColumnsDiffer(next, trade) ? [prisma.trade.update({ where: { id: trade.id }, data: next })] : [];
    });
    if (writes.length) await prisma.$transaction(writes);

    scanned += trades.length;
    updated += writes.length;
    cursor = trades[trades.length - 1].id;
    if (trades.length < CHUNK) break;
  }

  return { scanned, updated };
}

const CHUNK = 500;
