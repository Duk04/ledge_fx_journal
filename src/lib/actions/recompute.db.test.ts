/**
 * The stored P&L follows what it was derived from: an account's currency and
 * an instrument's spec, changed in the app, recompute the trades they affect
 * — and a recompute never rewrites a backtest run's trades.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFormData, defaultFormValues } from "@/components/trades/trade-form-values";
import { signInAs } from "../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../test/db/factories";
import { updateAccount } from "./accounts";
import { recomputeDerivedColumns, updateInstrument } from "./settings";
import { createTrade } from "./trades";

/** USDJPY short, 1 lot, 150.00 -> 149.50: +50 pips, ¥50,000 gross. */
function usdjpyShort() {
  return buildFormData(
    defaultFormValues({
      entryMode: "PRICE",
      symbol: "USDJPY",
      direction: "SHORT",
      status: "CLOSED",
      openedAt: "2026-03-04T13:30:00.000Z",
      closedAt: "2026-03-04T15:00:00.000Z",
      entryPrice: "150.00",
      exitPrice: "149.50",
      stopLoss: "150.50",
      volumeLots: "1",
    }),
  );
}

describe("recompute when an input changes outside the trade", () => {
  it("re-converts an account's P&L when its currency changes", async () => {
    await ensureInstruments("USDJPY");
    const user = await createUser();
    const account = await createAccount(user.id, { currency: "USD" });
    signInAs(user.id);
    const created = await createTrade(account.id, usdjpyShort());
    if (!created.ok) throw new Error(JSON.stringify(created));
    const before = await prisma.trade.findUniqueOrThrow({ where: { id: created.id } });
    // ¥50,000 at 149.50 per dollar.
    expect(before.netPnl?.toString()).toBe("334.45");

    const res = await updateAccount(account.id, {
      label: account.label,
      platform: "MT5",
      accountType: "DEMO",
      currency: "JPY",
      startingBalance: 1_000_000,
    });
    expect(res.ok).toBe(true);

    const after = await prisma.trade.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.netPnl?.toString()).toBe("50000");
  });

  it("recomputes every user's trades on an instrument whose spec the owner edits", async () => {
    await ensureInstruments("USDJPY");
    const owner = await createUser({ role: "OWNER" });
    const trader = await createUser();
    const account = await createAccount(trader.id, { currency: "JPY" });
    signInAs(trader.id);
    const created = await createTrade(account.id, usdjpyShort());
    if (!created.ok) throw new Error(JSON.stringify(created));

    signInAs(owner.id);
    const res = await updateInstrument("USDJPY", {
      pipSize: "0.01",
      contractSize: "1000",
      digits: 3,
      quoteCurrency: "JPY",
    });
    expect(res.ok).toBe(true);
    const after = await prisma.trade.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.netPnl?.toString()).toBe("500");

    // Put the shared spec back for every other test in this schema.
    await updateInstrument("USDJPY", { pipSize: "0.01", contractSize: "100000", digits: 3, quoteCurrency: "JPY" });
  });

  it("leaves a backtest's trades as the run wrote them", async () => {
    await ensureInstruments("USDJPY");
    const user = await createUser();
    const account = await createAccount(user.id, { currency: "USD" });
    signInAs(user.id);
    const created = await createTrade(account.id, usdjpyShort());
    if (!created.ok) throw new Error(JSON.stringify(created));
    // As a strategy run stores them: its own number, and a BACKTEST account.
    await prisma.tradingAccount.update({ where: { id: account.id }, data: { accountType: "BACKTEST" } });
    await prisma.trade.update({ where: { id: created.id }, data: { netPnl: "333.33" } });

    const res = await recomputeDerivedColumns();
    expect(res.ok).toBe(true);
    const after = await prisma.trade.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.netPnl?.toString()).toBe("333.33");
  });
});
