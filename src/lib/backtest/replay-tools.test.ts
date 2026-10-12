import { describe, expect, it } from "vitest";
import { defaultPositionTool, fibLevels, pointsFor, positionToolStats } from "./replay-tools";
import type { SimInstrument } from "./types";

const EURUSD: SimInstrument = {
  symbol: "EURUSD",
  digits: 5,
  pipSize: 0.0001,
  contractSize: 100_000,
  quoteCurrency: "USD",
  pointSize: 0.00001,
};

describe("fibLevels", () => {
  it("runs from the second click (0) back to the first (1)", () => {
    const levels = fibLevels({ i: 0, price: 1.1 }, { i: 10, price: 1.2 });
    expect(levels[0]).toEqual({ level: 0, price: 1.2 });
    expect(levels.at(-1)).toEqual({ level: 1, price: 1.1 });
    expect(levels.find((l) => l.level === 0.5)!.price).toBeCloseTo(1.15, 10);
  });
});

describe("pointsFor", () => {
  it("a horizontal line is one click, everything else two", () => {
    expect(pointsFor("hline")).toBe(1);
    expect(pointsFor("trend")).toBe(2);
    expect(pointsFor("fib")).toBe(2);
  });
});

describe("positionToolStats", () => {
  const ctx = { instrument: EURUSD, balance: 10_000, riskPct: 1, conversionRate: 1 };

  it("sizes to the risk budget and reports R:R", () => {
    // 20-pip stop, 40-pip target; 1% of 10k = $100; $10/pip/lot -> 0.5 lots.
    const s = positionToolStats({ side: "LONG", entry: 1.1, stop: 1.098, target: 1.104 }, ctx);
    expect(s.valid).toBe(true);
    expect(s.stopPips).toBeCloseTo(20, 9);
    expect(s.rr).toBeCloseTo(2, 9);
    expect(s.lots).toBe(0.5);
    expect(s.riskAmount).toBeCloseTo(100, 6);
    expect(s.rewardAmount).toBeCloseTo(200, 6);
  });

  it("rounds lots down, never risking more than the budget", () => {
    const s = positionToolStats({ side: "SHORT", entry: 1.1, stop: 1.1033, target: 1.09 }, ctx);
    expect(s.lots).toBe(0.3); // 100 / 330 = 0.303 -> 0.30
    expect(s.riskAmount!).toBeLessThanOrEqual(100);
  });

  it("flags a stop on the wrong side of the entry", () => {
    expect(positionToolStats({ side: "LONG", entry: 1.1, stop: 1.101, target: 1.11 }, ctx).valid).toBe(false);
    expect(positionToolStats({ side: "SHORT", entry: 1.1, stop: 1.099, target: 1.09 }, ctx).valid).toBe(false);
  });

  it("a zero stop distance has no size and no R:R", () => {
    const s = positionToolStats({ side: "LONG", entry: 1.1, stop: 1.1, target: 1.11 }, ctx);
    expect(s.lots).toBeNull();
    expect(s.rr).toBeNull();
  });
});

describe("defaultPositionTool", () => {
  it("starts at 1:2 on the right side for each direction", () => {
    expect(defaultPositionTool("LONG", 1.1, EURUSD)).toEqual({
      side: "LONG",
      entry: 1.1,
      stop: 1.1 - 0.002,
      target: 1.1 + 0.004,
    });
    const short = defaultPositionTool("SHORT", 1.1, EURUSD);
    expect(short.stop).toBeGreaterThan(1.1);
    expect(short.target).toBeLessThan(1.1);
  });
});
