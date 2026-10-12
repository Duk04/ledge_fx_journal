import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { NO_RULES, runWhatIf, type SimTrade } from "./what-if";
import { runMonteCarlo } from "./monte-carlo";
import { positionSize } from "./position-size";

const t = (i: number, r: number | null, extra: Partial<SimTrade> = {}): SimTrade => ({
  id: String(i),
  closedAt: i,
  netPnl: r === null ? 50 : r * 100,
  rMultiple: r,
  riskAmount: r === null ? null : 100,
  weekday: "MONDAY",
  session: "LONDON",
  symbol: "EURUSD",
  followedPlan: true,
  tagIds: [],
  ...extra,
});

describe("runWhatIf", () => {
  const trades = [t(1, 2), t(2, -3, { followedPlan: false }), t(3, -1), t(4, 1.5, { weekday: "FRIDAY" }), t(5, null)];

  it("with no rules, the scenario is the baseline", () => {
    const r = runWhatIf(trades, NO_RULES, 10_000);
    expect(r.scenario.netPnl).toBe(r.baseline.netPnl);
    expect(r.removed).toBe(0);
  });

  it("caps losses at −1R using each trade's own risk", () => {
    const r = runWhatIf(trades, { ...NO_RULES, capLossR: 1 }, 10_000);
    expect(r.capped).toBe(1);
    expect(r.scenario.netPnl - r.baseline.netPnl).toBe(200); // −300 became −100
  });

  it("skips by weekday and by plan adherence", () => {
    expect(runWhatIf(trades, { ...NO_RULES, skipWeekdays: ["FRIDAY"] }, 10_000).removed).toBe(1);
    const plan = runWhatIf(trades, { ...NO_RULES, onlyFollowedPlan: true }, 10_000);
    expect(plan.scenario.netPnl).toBe(plan.baseline.netPnl + 300);
  });

  it("fixed-percent sizing compounds and drops trades without a stop", () => {
    const r = runWhatIf([t(1, 1), t(2, 1)], { ...NO_RULES, fixedRiskPct: 10 }, 1000);
    expect(r.scenario.curve).toEqual([1000, 1100, 1210]);
    expect(runWhatIf(trades, { ...NO_RULES, fixedRiskPct: 1 }, 10_000).removed).toBe(1);
  });

  it("tracks max drawdown along the curve", () => {
    expect(runWhatIf([t(1, 1), t(2, -2), t(3, 0.5)], NO_RULES, 1000).baseline.maxDrawdown).toBe(200);
  });
});

describe("runMonteCarlo", () => {
  const input = {
    rMultiples: [2, -1, -1, 1.5, -1],
    startingBalance: 10_000,
    riskPct: 1,
    tradesPerRun: 100,
    runs: 500,
    ruinDrawdownPct: 20,
  };

  it("is deterministic for a seed", () => {
    expect(runMonteCarlo({ ...input, seed: 7 })).toEqual(runMonteCarlo({ ...input, seed: 7 }));
  });

  it("orders its percentiles and bounds its probabilities", () => {
    const r = runMonteCarlo(input)!;
    const { p5, p25, p50, p75, p95 } = r.final;
    expect(p5 <= p25 && p25 <= p50 && p50 <= p75 && p75 <= p95).toBe(true);
    expect(r.ruinProbability).toBeGreaterThanOrEqual(0);
    expect(r.ruinProbability).toBeLessThanOrEqual(1);
    expect(r.samplePaths).toHaveLength(5);
    expect(r.samplePaths[0]).toHaveLength(101);
  });

  it("a losing edge loses more often than a winning one", () => {
    const losing = runMonteCarlo({ ...input, rMultiples: [-1, -1, 1] })!;
    const winning = runMonteCarlo({ ...input, rMultiples: [2, 2, -1] })!;
    expect(losing.lossProbability).toBeGreaterThan(winning.lossProbability);
  });

  it("needs at least two outcomes", () => {
    expect(runMonteCarlo({ ...input, rMultiples: [1] })).toBeNull();
  });
});

describe("positionSize", () => {
  const EURUSD = {
    symbol: "EURUSD",
    pipSize: "0.0001",
    contractSize: "100000",
    digits: 5,
    quoteCurrency: "USD",
    assetClass: "FX" as const,
  };

  it("sizes to the risk budget and rounds down", () => {
    // 1% of 10,000 = 100; 20-pip stop at $10/pip/lot = $200 per lot -> 0.5 lots.
    const p = positionSize({
      instrument: EURUSD,
      balance: 10_000,
      riskPct: 1,
      entry: "1.1000",
      stop: "1.0980",
      conversionRate: 1,
    })!;
    expect([p.lots.toString(), p.stopPips.toString(), p.riskAmount.toString()]).toEqual(["0.5", "20", "100"]);
    // 13 pips -> 0.769… lots, rounded DOWN to 0.76.
    const q = positionSize({
      instrument: EURUSD,
      balance: 10_000,
      riskPct: 1,
      entry: "1.1000",
      stop: "1.0987",
      conversionRate: 1,
    })!;
    expect(q.lots.toString()).toBe("0.76");
    expect(q.riskAmount.lte(new Decimal(100))).toBe(true);
  });

  it("is null with the stop at entry", () => {
    expect(
      positionSize({ instrument: EURUSD, balance: 1, riskPct: 1, entry: "1.1", stop: "1.1", conversionRate: 1 }),
    ).toBeNull();
  });
});
