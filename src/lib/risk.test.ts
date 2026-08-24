import { describe, expect, it } from "vitest";
import { computeRiskGuard, type RiskTradeInput } from "./risk";

function trade(overrides: Partial<RiskTradeInput> = {}): RiskTradeInput {
  return { id: "t", netPnl: null, riskAmount: null, hasStop: true, ...overrides };
}

describe("computeRiskGuard — no-breach case", () => {
  it("reports nothing when there are no trades at all", () => {
    const result = computeRiskGuard({ trades: [], startingBalance: 10_000, riskPerTradePct: 1, equity: 10_000 });
    expect(result.breaches).toEqual([]);
    expect(result.dailyLossPct).toBe(0);
    expect(result.dailyLossAmount).toBe(0);
    expect(result.tradesToday).toBe(0);
    expect(result.consecutiveLosses).toBe(0);
  });

  it("reports nothing on a profitable, well-behaved day", () => {
    const result = computeRiskGuard({
      trades: [
        trade({ id: "1", netPnl: 100, riskAmount: 90, hasStop: true }),
        trade({ id: "2", netPnl: 50, riskAmount: 90, hasStop: true }),
      ],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.breaches).toEqual([]);
    expect(result.tradesToday).toBe(2);
    expect(result.consecutiveLosses).toBe(0);
  });
});

describe("computeRiskGuard — DAILY_LOSS_LIMIT", () => {
  it("fires once the day's realised loss reaches 3x the configured per-trade risk", () => {
    // 1% per trade configured -> 3% daily loss triggers it. Equity 10,000, so -300 is exactly 3%.
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -300 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.dailyLossPct).toBeCloseTo(3);
    expect(result.breaches.some((b) => b.type === "DAILY_LOSS_LIMIT")).toBe(true);
  });

  it("does not fire below the 3x threshold", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -200 })], // 2% of 10,000, threshold is 3%
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "DAILY_LOSS_LIMIT")).toBe(false);
  });

  it("falls back to a flat 3% when riskPerTradePct is unset", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -350 })], // 3.5% of 10,000
      startingBalance: 10_000,
      riskPerTradePct: null,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "DAILY_LOSS_LIMIT")).toBe(true);
  });

  it("does not fire under the flat 3% fallback", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -100 })], // 1% of 10,000
      startingBalance: 10_000,
      riskPerTradePct: null,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "DAILY_LOSS_LIMIT")).toBe(false);
  });

  it("never fires on a flat or profitable day even with a tiny equity base", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: 0 }), trade({ netPnl: 20 })],
      startingBalance: 100,
      riskPerTradePct: null,
      equity: 100,
    });
    expect(result.breaches.some((b) => b.type === "DAILY_LOSS_LIMIT")).toBe(false);
    expect(result.dailyLossAmount).toBe(0);
  });
});

describe("computeRiskGuard — LOSS_STREAK", () => {
  it("fires on two consecutive losses", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -10 }), trade({ netPnl: -10 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.consecutiveLosses).toBe(2);
    const breach = result.breaches.find((b) => b.type === "LOSS_STREAK");
    expect(breach?.message).toContain("Two losses in a row");
  });

  it("counts a longer trailing streak and words it accordingly", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -10 }), trade({ netPnl: -10 }), trade({ netPnl: -10 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.consecutiveLosses).toBe(3);
    const breach = result.breaches.find((b) => b.type === "LOSS_STREAK");
    expect(breach?.message).toContain("Three losses in a row");
  });

  it("does not fire when the streak is broken by a win", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -10 }), trade({ netPnl: -10 }), trade({ netPnl: 30 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.consecutiveLosses).toBe(0);
    expect(result.breaches.some((b) => b.type === "LOSS_STREAK")).toBe(false);
  });

  it("does not fire on a single loss", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: 10 }), trade({ netPnl: -10 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.consecutiveLosses).toBe(1);
    expect(result.breaches.some((b) => b.type === "LOSS_STREAK")).toBe(false);
  });
});

describe("computeRiskGuard — OVERSIZED", () => {
  it("fires when a trade risks more than 1.5x the configured per-trade risk", () => {
    // 1% configured, equity 10,000 -> 1.5x = $150. A $200 risk trade breaches.
    const result = computeRiskGuard({
      trades: [trade({ netPnl: null, hasStop: true, riskAmount: 200 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "OVERSIZED")).toBe(true);
  });

  it("does not fire exactly at the 1.5x boundary", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: null, hasStop: true, riskAmount: 150 })], // exactly 1.5%
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "OVERSIZED")).toBe(false);
  });

  it("never fires when no per-trade risk is configured", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: null, hasStop: true, riskAmount: 5_000 })], // huge, but nothing configured to compare against
      startingBalance: 10_000,
      riskPerTradePct: null,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "OVERSIZED")).toBe(false);
  });

  it("ignores trades with no stop for the oversized check (that's NO_STOP's job)", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: null, hasStop: false, riskAmount: null })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "OVERSIZED")).toBe(false);
  });
});

describe("computeRiskGuard — NO_STOP", () => {
  it("fires for a single trade with no stop, singular wording", () => {
    const result = computeRiskGuard({
      trades: [trade({ hasStop: false, riskAmount: null }), trade({ hasStop: true, riskAmount: 50 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    const breach = result.breaches.find((b) => b.type === "NO_STOP");
    expect(breach?.message).toBe("One trade today has no stop loss recorded.");
  });

  it("fires with a count when more than one trade has no stop", () => {
    const result = computeRiskGuard({
      trades: [trade({ hasStop: false }), trade({ hasStop: false })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    const breach = result.breaches.find((b) => b.type === "NO_STOP");
    expect(breach?.message).toBe("2 trades today have no stop loss recorded.");
  });

  it("applies to open trades too, not just closed ones", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: null, hasStop: false })], // still open
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "NO_STOP")).toBe(true);
    expect(result.tradesToday).toBe(0); // not realised yet
  });

  it("does not fire when every trade has a stop", () => {
    const result = computeRiskGuard({
      trades: [trade({ hasStop: true }), trade({ hasStop: true })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.breaches.some((b) => b.type === "NO_STOP")).toBe(false);
  });
});

describe("computeRiskGuard — miscellaneous", () => {
  it("dailyLossAmount nets wins against losses rather than summing losses alone", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -500 }), trade({ netPnl: 200 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    expect(result.dailyLossAmount).toBe(300);
  });

  it("does not divide by a zero or negative equity", () => {
    const result = computeRiskGuard({
      trades: [trade({ netPnl: -100 })],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 0,
    });
    expect(result.dailyLossPct).toBe(0);
    expect(Number.isFinite(result.dailyLossPct)).toBe(true);
  });

  it("can report multiple simultaneous breach types on a genuinely bad day", () => {
    const result = computeRiskGuard({
      trades: [
        trade({ id: "1", netPnl: -300, hasStop: true, riskAmount: 100 }),
        trade({ id: "2", netPnl: -200, hasStop: false, riskAmount: null }),
      ],
      startingBalance: 10_000,
      riskPerTradePct: 1,
      equity: 10_000,
    });
    const types = result.breaches.map((b) => b.type);
    expect(types).toContain("DAILY_LOSS_LIMIT");
    expect(types).toContain("LOSS_STREAK");
    expect(types).toContain("NO_STOP");
  });
});
