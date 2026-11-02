/**
 * `listAccounts()` sums and samples in SQL instead of loading every trade.
 * These hold its numbers to the metrics layer's own functions over the same
 * rows — `summarize()` for P&L and counts, `equityCurve()` for equity and the
 * sparkline — so the two cannot drift apart.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { equityCurve, summarize } from "@/lib/metrics";
import { toTradeRow } from "@/lib/trade-service";
import { createAccount, createUser, ensureInstruments } from "../../../test/db/factories";
import { listAccounts, thin } from "./accounts";

async function seedAccount(userId: string, opts: { archived?: boolean } = {}) {
  await ensureInstruments("EURUSD");
  const account = await createAccount(userId, { startingBalance: 10_000 });
  if (opts.archived) await prisma.tradingAccount.update({ where: { id: account.id }, data: { isArchived: true } });

  const base = Date.UTC(2026, 0, 5, 10);
  const closed = Array.from({ length: 40 }, (_, i) => ({
    accountId: account.id,
    symbol: "EURUSD",
    direction: "LONG" as const,
    status: "CLOSED" as const,
    entryPrice: "1.1",
    volumeLots: "1",
    openedAt: new Date(base + i * 3_600_000),
    // Two trades share a close time, to exercise the tiebreak.
    closedAt: new Date(base + Math.min(i, 38) * 3_600_000 + 1_800_000),
    netPnl: ((i % 3 === 0 ? -1 : 1) * (37.5 + i)).toFixed(2),
  }));
  const open = Array.from({ length: 3 }, (_, i) => ({
    accountId: account.id,
    symbol: "EURUSD",
    direction: "SHORT" as const,
    status: "OPEN" as const,
    entryPrice: "1.1",
    volumeLots: "1",
    openedAt: new Date(base + (50 + i) * 3_600_000),
  }));
  await prisma.trade.createMany({
    data: [
      ...closed,
      ...open,
      { ...open[0], status: "CANCELLED" as const, openedAt: new Date(base) },
      // Closed with no P&L yet (an R trade awaiting its result would look so):
      // open for summarize(), absent from the curve.
      { ...closed[0], closedAt: null, netPnl: null },
    ],
  });
  await prisma.balanceEvent.createMany({
    data: [
      { accountId: account.id, kind: "DEPOSIT", amount: "500", occurredAt: new Date(base + 5 * 3_600_000) },
      // Stored as a positive magnitude, the way an older file restores it.
      { accountId: account.id, kind: "WITHDRAWAL", amount: "200", occurredAt: new Date(base + 20 * 3_600_000) },
      { accountId: account.id, kind: "ADJUSTMENT", amount: "-12.34", occurredAt: new Date(base + 30 * 3_600_000) },
    ],
  });
  return account;
}

/** What listAccounts computed before it stopped loading trades. */
async function inMemory(accountId: string) {
  const account = await prisma.tradingAccount.findUniqueOrThrow({
    where: { id: accountId },
    include: { trades: { orderBy: [{ closedAt: "asc" }, { id: "asc" }] }, balanceEvents: true },
  });
  const rows = account.trades.map(toTradeRow);
  const events = account.balanceEvents.map((e) => ({
    kind: e.kind,
    amount: e.kind === "WITHDRAWAL" ? e.amount.abs().neg().toString() : e.amount.toString(),
    at: e.occurredAt,
  }));
  const curve = equityCurve(rows, account.startingBalance.toString(), events);
  const stats = summarize(rows);
  return {
    equity: curve[curve.length - 1].balance.toString(),
    netPnl: stats.netPnl.toString(),
    tradeCount: stats.tradeCount,
    openCount: stats.openCount,
    spark: thin(
      curve.map((p) => p.balance.toNumber()),
      24,
    ),
  };
}

describe("listAccounts", () => {
  it("matches summarize() and equityCurve() without loading the trades", async () => {
    const user = await createUser();
    const account = await seedAccount(user.id);

    const [summary] = await listAccounts(user.id);
    const expected = await inMemory(account.id);

    expect(summary.equity).toBe(expected.equity);
    expect(summary.netPnl).toBe(expected.netPnl);
    expect(summary.tradeCount).toBe(expected.tradeCount);
    expect(summary.openCount).toBe(expected.openCount);
    // A sample of the same curve: same ends, same length cap.
    expect(summary.spark.length).toBeLessThanOrEqual(24);
    expect(summary.spark[0]).toBe(expected.spark[0]);
    expect(summary.spark.at(-1)).toBe(expected.spark.at(-1));
  });

  it("leaves archived accounts out when asked, and never shows another user's", async () => {
    const user = await createUser();
    const other = await createUser();
    const live = await seedAccount(user.id);
    await seedAccount(user.id, { archived: true });
    await seedAccount(other.id);

    expect((await listAccounts(user.id)).map((a) => a.isArchived).sort()).toEqual([false, true]);
    expect((await listAccounts(user.id, { includeArchived: false })).map((a) => a.id)).toEqual([live.id]);
  });
});
