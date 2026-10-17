import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  classifyOutcome,
  computeGrossPnl,
  computeHoldingMinutes,
  computeNetPnl,
  computePips,
  computePlannedRR,
  computeRTrade,
  computeRiskAmount,
  computeRMultiple,
  computeTrade,
  pipValuePerLot,
  validateTradeGeometry,
} from "./trade";
import type { InstrumentSpec, TradeInput } from "./types";

const EURUSD: InstrumentSpec = {
  symbol: "EURUSD",
  pipSize: "0.0001",
  contractSize: 100000,
  digits: 5,
  quoteCurrency: "USD",
  assetClass: "FX",
};

const USDJPY: InstrumentSpec = {
  symbol: "USDJPY",
  pipSize: "0.01",
  contractSize: 100000,
  digits: 3,
  quoteCurrency: "JPY",
  assetClass: "FX",
};

const XAUUSD: InstrumentSpec = {
  symbol: "XAUUSD",
  pipSize: "0.01",
  contractSize: 100,
  digits: 2,
  quoteCurrency: "USD",
  assetClass: "METAL",
};

const NAS100: InstrumentSpec = {
  symbol: "NAS100",
  pipSize: "1",
  contractSize: 1,
  digits: 1,
  quoteCurrency: "USD",
  assetClass: "INDEX",
};

function baseTrade(overrides: Partial<TradeInput>): TradeInput {
  return {
    instrument: EURUSD,
    direction: "LONG",
    entryPrice: "1.0850",
    volumeLots: 1,
    openedAt: new Date("2026-01-01T08:00:00Z"),
    ...overrides,
  };
}

describe("pipValuePerLot", () => {
  it("EURUSD: pipSize * contractSize", () => {
    expect(pipValuePerLot(EURUSD).toString()).toBe("10");
  });

  it("applies an explicit conversionRate", () => {
    expect(pipValuePerLot(USDJPY, new Decimal(1).div("151.70")).toString()).toBe(
      new Decimal(1000).div("151.70").toString(),
    );
  });
});

describe("computePips / computeGrossPnl — EURUSD", () => {
  it("long winner: entry 1.0850 -> exit 1.0900, 1.0 lot = 50 pips, gross 500 USD", () => {
    const trade = baseTrade({ direction: "LONG", entryPrice: "1.0850", exitPrice: "1.0900", volumeLots: 1 });
    expect(computePips(trade)!.toString()).toBe("50");
    expect(computeGrossPnl(trade)!.toString()).toBe("500");
  });

  it("short winner: entry 1.0900 -> exit 1.0850 is a 50 pip win for a short", () => {
    const trade = baseTrade({ direction: "SHORT", entryPrice: "1.0900", exitPrice: "1.0850", volumeLots: 1 });
    expect(computePips(trade)!.toString()).toBe("50");
    expect(computeGrossPnl(trade)!.toString()).toBe("500");
  });

  it("short loser: entry 1.0850 -> exit 1.0900 is a 50 pip loss for a short", () => {
    const trade = baseTrade({ direction: "SHORT", entryPrice: "1.0850", exitPrice: "1.0900", volumeLots: 1 });
    expect(computePips(trade)!.toString()).toBe("-50");
    expect(computeGrossPnl(trade)!.toString()).toBe("-500");
  });

  it("0.01 micro lot: no floating point drift on a 1-pip move", () => {
    // Native JS float: 1.0851 - 1.0850 = 0.00009999999999998899, and dividing
    // by 0.0001 gives 0.9999999999998899 instead of exactly 1. Decimal must
    // not reproduce that drift.
    const trade = baseTrade({ direction: "LONG", entryPrice: "1.0850", exitPrice: "1.0851", volumeLots: "0.01" });
    expect(computePips(trade)!.toString()).toBe("1");
    expect(computeGrossPnl(trade)!.toString()).toBe("0.1");
  });
});

describe("quote-currency conversion — USDJPY", () => {
  const trade = baseTrade({
    instrument: USDJPY,
    direction: "LONG",
    entryPrice: "151.20",
    exitPrice: "151.70",
    volumeLots: "0.5",
  });

  it("50 pips, pipValuePerLot = 0.01 * 100000 = 1000 JPY", () => {
    expect(computePips(trade)!.toString()).toBe("50");
    expect(pipValuePerLot(USDJPY).toString()).toBe("1000");
    expect(computeGrossPnl(trade)!.toString()).toBe("25000"); // JPY, no conversion applied
  });

  it("converts to account currency (USD) via an explicit conversionRate = 1 / 151.70", () => {
    const usdTrade = { ...trade, conversionRate: new Decimal(1).div("151.70") };
    // Cross-checked independently: 25000 / 151.70 = 164.7989452867501648
    expect(computeGrossPnl(usdTrade)!.toString()).toBe("164.7989452867501648");
  });
});

describe("XAUUSD and index contracts", () => {
  it("XAUUSD: pipSize 0.01, contractSize 100", () => {
    const trade = baseTrade({
      instrument: XAUUSD,
      direction: "LONG",
      entryPrice: "2310.50",
      exitPrice: "2325.00",
      volumeLots: "0.10",
    });
    expect(computePips(trade)!.toString()).toBe("1450");
    expect(pipValuePerLot(XAUUSD).toString()).toBe("1");
    expect(computeGrossPnl(trade)!.toString()).toBe("145");
  });

  it("NAS100: pipSize 1, contractSize 1", () => {
    const trade = baseTrade({
      instrument: NAS100,
      direction: "LONG",
      entryPrice: "20000",
      exitPrice: "20050",
      volumeLots: "2",
    });
    expect(computePips(trade)!.toString()).toBe("50");
    expect(pipValuePerLot(NAS100).toString()).toBe("1");
    expect(computeGrossPnl(trade)!.toString()).toBe("100");
  });
});

describe("computeNetPnl — commission and swap", () => {
  it("subtracts a positive commission and positive swap", () => {
    const trade = baseTrade({ exitPrice: "1.0900", volumeLots: 1, commission: "7", swap: "2" });
    expect(computeNetPnl(trade)!.toString()).toBe("491"); // 500 - 7 - 2
  });

  it("a negative swap (credit) is added back, not subtracted", () => {
    const trade = baseTrade({ exitPrice: "1.0900", volumeLots: 1, commission: "7", swap: "-2" });
    expect(computeNetPnl(trade)!.toString()).toBe("495"); // 500 - 7 - (-2)
  });
});

describe("R multiple", () => {
  it("entry 1.0850, sl 1.0800, exit 1.0950 => risk 50 pips, reward 100 pips, R = 2.00 exactly", () => {
    const trade = baseTrade({ entryPrice: "1.0850", stopLoss: "1.0800", exitPrice: "1.0950", volumeLots: 1 });
    expect(computeRiskAmount(trade)!.toString()).toBe("500");
    expect(computeRMultiple(trade)!.toString()).toBe("2");
  });

  it("the same trade with commission comes in slightly under R = 2", () => {
    const trade = baseTrade({
      entryPrice: "1.0850",
      stopLoss: "1.0800",
      exitPrice: "1.0950",
      volumeLots: 1,
      commission: "50",
    });
    const r = computeRMultiple(trade)!;
    expect(r.toString()).toBe("1.9");
    expect(r.lt(2)).toBe(true);
  });

  it("no stop loss => riskAmount and rMultiple are both null", () => {
    const trade = baseTrade({ entryPrice: "1.0850", exitPrice: "1.0950", volumeLots: 1 });
    expect(computeRiskAmount(trade)).toBeNull();
    expect(computeRMultiple(trade)).toBeNull();
  });
});

describe("computePlannedRR", () => {
  it("computes reward:risk from entry/sl/tp", () => {
    const trade = baseTrade({ entryPrice: "1.0850", stopLoss: "1.0800", takeProfit: "1.0950" });
    expect(computePlannedRR(trade)!.toString()).toBe("2");
  });

  it("is null when the stop loss is on the wrong side of entry", () => {
    const trade = baseTrade({ direction: "LONG", entryPrice: "1.0850", stopLoss: "1.0900", takeProfit: "1.0950" });
    expect(computePlannedRR(trade)).toBeNull();
  });

  it("is null when either leg is missing", () => {
    expect(computePlannedRR(baseTrade({ stopLoss: "1.0800" }))).toBeNull();
    expect(computePlannedRR(baseTrade({ takeProfit: "1.0950" }))).toBeNull();
  });
});

describe("validateTradeGeometry", () => {
  it("flags a long stop loss placed above entry", () => {
    const problems = validateTradeGeometry(baseTrade({ direction: "LONG", entryPrice: "1.0850", stopLoss: "1.0900" }));
    expect(problems.some((p) => p.code === "SL_WRONG_SIDE")).toBe(true);
  });

  it("flags a short take profit placed above entry", () => {
    const problems = validateTradeGeometry(
      baseTrade({ direction: "SHORT", entryPrice: "1.0850", takeProfit: "1.0950" }),
    );
    expect(problems.some((p) => p.code === "TP_WRONG_SIDE")).toBe(true);
  });

  it("flags zero and negative volume", () => {
    expect(validateTradeGeometry(baseTrade({ volumeLots: 0 })).some((p) => p.code === "ZERO_OR_NEGATIVE_VOLUME")).toBe(
      true,
    );
    expect(
      validateTradeGeometry(baseTrade({ volumeLots: "-1" })).some((p) => p.code === "ZERO_OR_NEGATIVE_VOLUME"),
    ).toBe(true);
  });

  it("flags closedAt before openedAt", () => {
    const problems = validateTradeGeometry(
      baseTrade({
        openedAt: new Date("2026-01-02T00:00:00Z"),
        closedAt: new Date("2026-01-01T00:00:00Z"),
        exitPrice: "1.0900",
      }),
    );
    expect(problems.some((p) => p.code === "CLOSED_BEFORE_OPENED")).toBe(true);
  });

  it("a clean, valid trade has no problems", () => {
    const problems = validateTradeGeometry(
      baseTrade({ entryPrice: "1.0850", stopLoss: "1.0800", takeProfit: "1.0950", exitPrice: "1.0900" }),
    );
    expect(problems).toEqual([]);
  });
});

describe("computeHoldingMinutes", () => {
  it("computes whole minutes between open and close", () => {
    const trade = baseTrade({
      openedAt: new Date("2026-01-01T08:00:00Z"),
      closedAt: new Date("2026-01-01T11:20:00Z"),
      exitPrice: "1.0900",
    });
    expect(computeHoldingMinutes(trade)).toBe(200);
  });

  it("is null while the trade is open", () => {
    expect(computeHoldingMinutes(baseTrade({}))).toBeNull();
  });
});

describe("classifyOutcome", () => {
  it("is OPEN for an open trade regardless of netPnl", () => {
    expect(classifyOutcome(null, "OPEN")).toBe("OPEN");
  });

  it("treats |netPnl| < 0.005 as BREAKEVEN", () => {
    expect(classifyOutcome(new Decimal("0.004"), "CLOSED")).toBe("BREAKEVEN");
    expect(classifyOutcome(new Decimal("-0.004"), "CLOSED")).toBe("BREAKEVEN");
  });

  it("0.005 exactly is NOT breakeven (boundary is exclusive)", () => {
    expect(classifyOutcome(new Decimal("0.005"), "CLOSED")).toBe("WIN");
    expect(classifyOutcome(new Decimal("-0.005"), "CLOSED")).toBe("LOSS");
  });

  it("classifies clear wins and losses", () => {
    expect(classifyOutcome(new Decimal("12.34"), "CLOSED")).toBe("WIN");
    expect(classifyOutcome(new Decimal("-12.34"), "CLOSED")).toBe("LOSS");
  });
});

describe("computeTrade — single entry point", () => {
  it("returns OPEN with all-null derived fields when there is no exit yet", () => {
    const result = computeTrade(baseTrade({ stopLoss: "1.0800" }));
    expect(result.outcome).toBe("OPEN");
    expect(result.pips).toBeNull();
    expect(result.grossPnl).toBeNull();
    expect(result.netPnl).toBeNull();
    expect(result.rMultiple).toBeNull();
    expect(result.holdingMinutes).toBeNull();
    expect(result.riskAmount).not.toBeNull(); // risk is known even before exit
  });

  it("returns a fully populated WIN result for a closed winning trade", () => {
    const result = computeTrade(
      baseTrade({
        entryPrice: "1.0850",
        stopLoss: "1.0800",
        takeProfit: "1.0950",
        exitPrice: "1.0950",
        volumeLots: 1,
        openedAt: new Date("2026-01-01T08:00:00Z"),
        closedAt: new Date("2026-01-01T09:00:00Z"),
      }),
    );
    expect(result.outcome).toBe("WIN");
    expect(result.pips!.toString()).toBe("100");
    expect(result.netPnl!.toString()).toBe("1000");
    expect(result.rMultiple!.toString()).toBe("2");
    expect(result.plannedRR!.toString()).toBe("2");
    expect(result.holdingMinutes).toBe(60);
  });
});

describe("initialStopLoss", () => {
  // Long EURUSD 1 lot, entry 1.1000, opened with a 10-pip stop at 1.0990,
  // stop later trailed to breakeven, closed at 1.1020 (+20 pips, $200).
  const base = {
    instrument: {
      symbol: "EURUSD",
      pipSize: "0.0001",
      contractSize: "100000",
      digits: 5,
      quoteCurrency: "USD",
      assetClass: "FX" as const,
    },
    direction: "LONG" as const,
    entryPrice: "1.1000",
    exitPrice: "1.1020",
    takeProfit: "1.1030",
    volumeLots: "1",
    openedAt: new Date("2026-03-04T10:00:00Z"),
    closedAt: new Date("2026-03-04T12:00:00Z"),
  };

  it("measures risk against the stop the trade was opened with, not the moved one", () => {
    const r = computeTrade({ ...base, stopLoss: "1.1000", initialStopLoss: "1.0990" });
    expect(r.riskAmount!.toString()).toBe("100");
    expect(r.rMultiple!.toString()).toBe("2");
    expect(r.plannedRR!.toString()).toBe("3");
  });

  it("falls back to stopLoss when no initial stop is recorded", () => {
    const r = computeTrade({ ...base, stopLoss: "1.0990" });
    expect(r.rMultiple!.toString()).toBe("2");
  });

  it("without it, a stop moved to breakeven leaves R undefined", () => {
    expect(computeTrade({ ...base, stopLoss: "1.1000" }).rMultiple).toBeNull();
  });
});

describe("computeRTrade", () => {
  const base = {
    mode: "R_MULTIPLE" as const,
    plannedRisk: "100",
    plannedRR: "2.5",
    openedAt: new Date("2026-09-08T10:00:00Z"),
  };

  it("turns R into money through the risk", () => {
    const r = computeRTrade({ ...base, resultR: "2.5", closedAt: new Date("2026-09-08T12:00:00Z") });
    expect(r.netPnl?.toString()).toBe("250");
    expect(r.rMultiple?.toString()).toBe("2.5");
    expect(r.riskAmount?.toString()).toBe("100");
    expect(r.plannedRR?.toString()).toBe("2.5");
    expect(r.holdingMinutes).toBe(120);
    expect(r.outcome).toBe("WIN");
    expect(r.pips).toBeNull();
  });

  it("keeps R as entered while costs come out of P&L", () => {
    const r = computeRTrade({ ...base, resultR: "-1", commission: "7", swap: "-2" });
    expect(r.netPnl?.toString()).toBe("-105");
    expect(r.rMultiple?.toString()).toBe("-1");
    expect(r.outcome).toBe("LOSS");
  });

  it("is open, with no P&L, until there is a result", () => {
    const r = computeRTrade(base);
    expect(r.netPnl).toBeNull();
    expect(r.rMultiple).toBeNull();
    expect(r.outcome).toBe("OPEN");
  });

  it("calls a 0R result breakeven", () => {
    expect(computeRTrade({ ...base, resultR: "0" }).outcome).toBe("BREAKEVEN");
  });
});
