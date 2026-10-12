import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { computePropStatus, type PropRules } from "./prop";
import type { EquityPoint } from "@/lib/metrics/types";

const RULES: PropRules = {
  dailyLossLimitPct: 5,
  maxDrawdownPct: 10,
  drawdownMode: "STATIC",
  profitTargetPct: 10,
  minTradingDays: 4,
};

/** A curve from a list of balances, one TRADE point per day. */
function curve(...balances: number[]): EquityPoint[] {
  return balances.map((b, i) => ({
    at: new Date(Date.UTC(2026, 2, 2 + i)),
    balance: new Decimal(b),
    change: new Decimal(0),
    kind: "TRADE" as const,
  }));
}

const base = { startingBalance: 100_000, todayPnl: 0, tradingDays: 0, rules: RULES };

describe("computePropStatus", () => {
  it("in progress: part of the way to target, inside every limit", () => {
    const s = computePropStatus({ ...base, curve: curve(102_000, 104_000), todayPnl: 2000, tradingDays: 2 });
    expect(s.verdict).toBe("IN_PROGRESS");
    expect(s.profitTarget).toMatchObject({ met: false, progress: 0.4 });
    expect(s.profitTarget!.remaining.toString()).toBe("6000");
    expect(s.maxDrawdown!.floor.toString()).toBe("90000");
    expect(s.minTradingDays).toEqual({ required: 4, done: 2, met: false });
  });

  it("passes only when the target AND the minimum days are met", () => {
    const hit = { ...base, curve: curve(105_000, 110_500) };
    expect(computePropStatus({ ...hit, tradingDays: 3 }).verdict).toBe("IN_PROGRESS");
    expect(computePropStatus({ ...hit, tradingDays: 4 }).verdict).toBe("PASSED");
  });

  it("daily loss is measured against the starting balance", () => {
    const s = computePropStatus({ ...base, curve: curve(95_000), todayPnl: -5000 });
    expect(s.dailyLoss).toMatchObject({ breached: true, progress: 1 });
    expect(s.verdict).toBe("FAILED");
    expect(computePropStatus({ ...base, curve: curve(96_000), todayPnl: -4000 }).dailyLoss!.remaining.toString()).toBe(
      "1000",
    );
  });

  it("a static drawdown breach sticks even after the balance recovers", () => {
    const s = computePropStatus({ ...base, curve: curve(95_000, 89_900, 101_000) });
    expect(s.maxDrawdown!.breached).toBe(true);
    expect(s.verdict).toBe("FAILED");
  });

  it("a trailing floor rises with the closed-balance peak", () => {
    const rules = { ...RULES, drawdownMode: "TRAILING" as const };
    // Peak 108k -> floor 97.2k; closing at 97k breaks it, though a static
    // floor (90k) would not have.
    const s = computePropStatus({ ...base, rules, curve: curve(108_000, 97_000) });
    expect(s.maxDrawdown!.floor.toString()).toBe("97200");
    expect(s.maxDrawdown!.breached).toBe(true);
  });

  it("a deposit does not raise the trailing floor", () => {
    const rules = { ...RULES, drawdownMode: "TRAILING" as const };
    const points = curve(100_000, 150_000);
    points[1] = { ...points[1], kind: "DEPOSIT" };
    expect(computePropStatus({ ...base, rules, curve: points }).maxDrawdown!.floor.toString()).toBe("90000");
  });

  it("with no curve the balance is the starting balance", () => {
    expect(computePropStatus({ ...base, curve: [] }).balance.toString()).toBe("100000");
  });
});
