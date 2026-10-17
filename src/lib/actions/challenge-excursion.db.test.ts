/**
 * Prop-challenge rules end to end (stored on the account, evaluated by the
 * overview query) and MAE/MFE from stored M1 candles.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { overview } from "@/lib/queries/analytics";
import { buildFormData, defaultFormValues } from "@/components/trades/trade-form-values";
import { signInAs } from "../../../test/db/auth";
import { createUser, ensureInstruments } from "../../../test/db/factories";
import { createAccount } from "./accounts";
import { fillExcursionFromCandles } from "./excursion";
import { createTrade } from "./trades";

async function accountWithRules() {
  await ensureInstruments("EURUSD");
  const user = await createUser();
  signInAs(user.id);
  const res = await createAccount({
    label: "FTMO 100k",
    platform: "MT5",
    accountType: "PROP",
    currency: "USD",
    startingBalance: "100000",
    dailyLossLimitPct: "5",
    maxDrawdownPct: "10",
    drawdownMode: "STATIC",
    profitTargetPct: "10",
    minTradingDays: "4",
  });
  expect(res.ok).toBe(true);
  const account = await prisma.tradingAccount.findFirstOrThrow({ where: { userId: user.id, label: "FTMO 100k" } });
  return { user, account };
}

async function closedTrade(accountId: string, exitPrice: string, openedAt: string, closedAt: string) {
  const res = await createTrade(
    accountId,
    buildFormData(
      defaultFormValues({
        entryMode: "PRICE",
        symbol: "EURUSD",
        direction: "LONG",
        status: "CLOSED",
        openedAt,
        closedAt,
        entryPrice: "1.10000",
        exitPrice,
        stopLoss: "1.09900",
        volumeLots: "10",
      }),
    ),
  );
  if (!res.ok) throw new Error(res.formError ?? JSON.stringify(res.fieldErrors));
  return res.id;
}

describe("prop challenge", () => {
  it("stores the rules and reports progress on the dashboard", async () => {
    const { user, account } = await accountWithRules();
    expect(account.dailyLossLimitPct?.toString()).toBe("5");
    expect(account.minTradingDays).toBe(4);

    // +20 pips × 10 lots = +$2,000, closed on one day.
    await closedTrade(account.id, "1.10200", "2026-03-04T10:00:00Z", "2026-03-04T12:00:00Z");

    const ov = await overview({ userId: user.id, accountId: account.id, from: null, to: null });
    expect(ov.prop).toMatchObject({
      verdict: "IN_PROGRESS",
      balance: 102000,
      profitTarget: { threshold: 110000, remaining: 8000, met: false },
      maxDrawdown: { floor: 90000, breached: false },
      minTradingDays: { required: 4, done: 1, met: false },
    });
    expect(ov.prop!.profitTarget!.progress).toBeCloseTo(0.2);
  });

  it("an account without rules has no challenge panel", async () => {
    const user = await createUser();
    signInAs(user.id);
    await createAccount({
      label: "Plain",
      platform: "MT5",
      accountType: "LIVE",
      currency: "USD",
      startingBalance: "5000",
    });
    const account = await prisma.tradingAccount.findFirstOrThrow({ where: { userId: user.id } });
    const ov = await overview({ userId: user.id, accountId: account.id, from: null, to: null });
    expect(ov.prop).toBeNull();
  });
});

describe("fillExcursionFromCandles", () => {
  it("measures MAE/MFE from M1 bars inside the holding period", async () => {
    const { account } = await accountWithRules();
    const id = await closedTrade(account.id, "1.10200", "2026-03-05T10:00:30Z", "2026-03-05T10:05:20Z");
    await prisma.candle.createMany({
      skipDuplicates: true,
      data: [
        ["10:00", "1.1100", "1.0900"],
        ["10:01", "1.1005", "1.0990"],
        ["10:02", "1.1030", "1.0995"],
        ["10:03", "1.1025", "1.1000"],
        ["10:04", "1.1022", "1.1010"],
        ["10:05", "1.1200", "1.0800"],
      ].map(([t, high, low]) => ({
        symbol: "EURUSD",
        timeframe: "M1" as const,
        ts: new Date(`2026-03-05T${t}:00Z`),
        open: "1.1",
        high,
        low,
        close: "1.1",
        source: "GENERIC_CSV" as const,
      })),
    });

    const res = await fillExcursionFromCandles(account.id, id);
    expect(res).toMatchObject({ ok: true, maePrice: "1.099", mfePrice: "1.103", barsUsed: 4 });
    const t = await prisma.trade.findUniqueOrThrow({ where: { id } });
    expect([t.maePrice?.toString(), t.mfePrice?.toString()]).toEqual(["1.099", "1.103"]);
  });

  it("refuses when no candles cover the trade", async () => {
    const { account } = await accountWithRules();
    const id = await closedTrade(account.id, "1.10200", "2025-01-06T10:00:00Z", "2025-01-06T14:00:00Z");
    expect(await fillExcursionFromCandles(account.id, id)).toMatchObject({ ok: false });
  });
});
