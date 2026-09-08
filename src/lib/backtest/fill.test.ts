import { describe, expect, it } from "vitest";
import { closeAtPrice, entryPrice, exitAtMarket, exitOnBar, pipsBetween, pointsToPrice, priceToPoints } from "./fill";
import type { Bar, FillModel, SimInstrument, SimPosition } from "./types";
import { computeTrade } from "../metrics";

const EURUSD: SimInstrument = {
  symbol: "EURUSD",
  digits: 5,
  pipSize: 0.0001,
  contractSize: 100_000,
  quoteCurrency: "USD",
  pointSize: 0.00001,
};

const USDJPY: SimInstrument = {
  symbol: "USDJPY",
  digits: 3,
  pipSize: 0.01,
  contractSize: 100_000,
  quoteCurrency: "JPY",
  pointSize: 0.001,
};

const XAUUSD: SimInstrument = {
  symbol: "XAUUSD",
  digits: 2,
  pipSize: 0.01,
  contractSize: 100,
  quoteCurrency: "USD",
  pointSize: 0.01,
};

const NAS100: SimInstrument = {
  symbol: "NAS100",
  digits: 1,
  pipSize: 0.1,
  contractSize: 1,
  quoteCurrency: "USD",
  pointSize: 0.1,
};

function fillModel(overrides: Partial<FillModel> = {}): FillModel {
  return {
    spreadPoints: 10, // 1 pip for a 5-digit instrument
    commissionPerLot: 0,
    slippagePoints: 0,
    pessimisticFills: true,
    conversionRate: 1,
    ...overrides,
  };
}

function bar(overrides: Partial<Bar> = {}): Bar {
  return { ts: 0, open: 1.1, high: 1.1, low: 1.1, close: 1.1, ...overrides };
}

describe("pointsToPrice / priceToPoints", () => {
  it("converts points to a price delta using the instrument's pointSize", () => {
    expect(pointsToPrice(EURUSD, 10)).toBeCloseTo(0.0001, 10);
    expect(pointsToPrice(USDJPY, 10)).toBeCloseTo(0.01, 10);
  });

  it("is the inverse of priceToPoints", () => {
    expect(priceToPoints(EURUSD, 0.0001)).toBeCloseTo(10, 8);
    expect(priceToPoints(XAUUSD, 0.02)).toBeCloseTo(2, 8);
  });
});

describe("pipsBetween", () => {
  it("is positive for a favourable long move", () => {
    expect(pipsBetween(EURUSD, 1.1, 1.105, "LONG")).toBeCloseTo(50, 6);
  });

  it("is negative for an unfavourable long move", () => {
    expect(pipsBetween(EURUSD, 1.1, 1.095, "LONG")).toBeCloseTo(-50, 6);
  });

  it("flips sign for a short", () => {
    expect(pipsBetween(EURUSD, 1.1, 1.095, "SHORT")).toBeCloseTo(50, 6);
    expect(pipsBetween(EURUSD, 1.1, 1.105, "SHORT")).toBeCloseTo(-50, 6);
  });

  it("uses the instrument's own pip size (JPY)", () => {
    expect(pipsBetween(USDJPY, 110, 110.1, "LONG")).toBeCloseTo(10, 6);
  });
});

describe("entryPrice", () => {
  it("fills a long at the bar's open plus half spread (against the trader)", () => {
    const fill = fillModel({ spreadPoints: 10, slippagePoints: 0 });
    const b = bar({ open: 1.1 });
    // half of 10 points (0.0001) = 0.00005
    expect(entryPrice(b, "LONG", fill, EURUSD)).toBeCloseTo(1.10005, 8);
  });

  it("fills a short at the bar's open minus half spread", () => {
    const fill = fillModel({ spreadPoints: 10, slippagePoints: 0 });
    const b = bar({ open: 1.1 });
    expect(entryPrice(b, "SHORT", fill, EURUSD)).toBeCloseTo(1.09995, 8);
  });

  it("applies slippage against the trader on top of spread", () => {
    const fill = fillModel({ spreadPoints: 10, slippagePoints: 5 });
    const b = bar({ open: 1.1 });
    // half spread 0.00005 + slippage 0.00005 = 0.0001
    expect(entryPrice(b, "LONG", fill, EURUSD)).toBeCloseTo(1.1001, 8);
    expect(entryPrice(b, "SHORT", fill, EURUSD)).toBeCloseTo(1.0999, 8);
  });

  it("never fills at the bar's close, only its open", () => {
    const fill = fillModel({ spreadPoints: 0, slippagePoints: 0 });
    const b = bar({ open: 1.1, close: 1.2 });
    expect(entryPrice(b, "LONG", fill, EURUSD)).toBeCloseTo(1.1, 8);
  });

  it("uses the bar's own recorded spread over the fill model default", () => {
    const fill = fillModel({ spreadPoints: 100, slippagePoints: 0 });
    const b = bar({ open: 1.1, spread: 10 });
    expect(entryPrice(b, "LONG", fill, EURUSD)).toBeCloseTo(1.10005, 8);
  });

  it("with zero spread and zero slippage, fills exactly at open", () => {
    const fill = fillModel({ spreadPoints: 0, slippagePoints: 0 });
    const b = bar({ open: 1.2345 });
    expect(entryPrice(b, "LONG", fill, EURUSD)).toBeCloseTo(1.2345, 8);
    expect(entryPrice(b, "SHORT", fill, EURUSD)).toBeCloseTo(1.2345, 8);
  });
});

describe("exitAtMarket", () => {
  it("closing a LONG crosses the spread like opening a SHORT (gets the bid)", () => {
    const fill = fillModel({ spreadPoints: 10, slippagePoints: 0 });
    expect(exitAtMarket(1.1, "LONG", fill, EURUSD)).toBeCloseTo(1.09995, 8);
  });

  it("closing a SHORT crosses the spread like opening a LONG (gets the ask)", () => {
    const fill = fillModel({ spreadPoints: 10, slippagePoints: 0 });
    expect(exitAtMarket(1.1, "SHORT", fill, EURUSD)).toBeCloseTo(1.10005, 8);
  });

  it("applies slippage against the trader on a market exit too", () => {
    const fill = fillModel({ spreadPoints: 10, slippagePoints: 5 });
    expect(exitAtMarket(1.1, "LONG", fill, EURUSD)).toBeCloseTo(1.0999, 8);
  });
});

describe("exitOnBar — long positions", () => {
  const zeroCostFill = fillModel({ spreadPoints: 0, slippagePoints: 0 });

  function longPosition(overrides: Partial<SimPosition> = {}): SimPosition {
    return { side: "LONG", lots: 1, entryTs: 0, entryPrice: 1.1, stopLoss: 1.095, takeProfit: 1.11, ...overrides };
  }

  it("returns null when neither level is touched", () => {
    const b = bar({ open: 1.1, high: 1.102, low: 1.098, close: 1.1 });
    expect(exitOnBar(longPosition(), b, zeroCostFill, EURUSD)).toBeNull();
  });

  it("hits the stop when the low reaches it, at the exact stop price (no gap)", () => {
    const b = bar({ open: 1.1, high: 1.101, low: 1.094, close: 1.096 });
    const result = exitOnBar(longPosition(), b, zeroCostFill, EURUSD);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("STOP_LOSS");
    expect(result!.price).toBeCloseTo(1.095, 8);
  });

  it("hits the target when the high reaches it, at the exact target price", () => {
    const b = bar({ open: 1.1, high: 1.112, low: 1.099, close: 1.111 });
    const result = exitOnBar(longPosition(), b, zeroCostFill, EURUSD);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("TAKE_PROFIT");
    expect(result!.price).toBeCloseTo(1.11, 8);
  });

  it("a gap through the stop fills at the bar's OPEN, not the stop price", () => {
    // Bar opens already below the stop (a gap down through it overnight).
    const b = bar({ open: 1.09, high: 1.091, low: 1.08, close: 1.085 });
    const result = exitOnBar(longPosition(), b, zeroCostFill, EURUSD);
    expect(result!.reason).toBe("STOP_LOSS");
    expect(result!.price).toBeCloseTo(1.09, 8); // the open, worse than the 1.095 stop
    expect(result!.price).not.toBeCloseTo(1.095, 4);
  });

  it("a gap through the target fills at the bar's open too", () => {
    const b = bar({ open: 1.115, high: 1.12, low: 1.113, close: 1.118 });
    const result = exitOnBar(longPosition(), b, zeroCostFill, EURUSD);
    expect(result!.reason).toBe("TAKE_PROFIT");
    expect(result!.price).toBeCloseTo(1.115, 8);
  });

  it("both levels in range, pessimisticFills true -> stop wins", () => {
    const pessimistic = fillModel({ spreadPoints: 0, slippagePoints: 0, pessimisticFills: true });
    const b = bar({ open: 1.1, high: 1.111, low: 1.094, close: 1.1 });
    const result = exitOnBar(longPosition(), b, pessimistic, EURUSD);
    expect(result!.reason).toBe("STOP_LOSS");
    expect(result!.price).toBeCloseTo(1.095, 8);
  });

  it("both levels in range, pessimisticFills false -> target wins", () => {
    const optimistic = fillModel({ spreadPoints: 0, slippagePoints: 0, pessimisticFills: false });
    const b = bar({ open: 1.1, high: 1.111, low: 1.094, close: 1.1 });
    const result = exitOnBar(longPosition(), b, optimistic, EURUSD);
    expect(result!.reason).toBe("TAKE_PROFIT");
    expect(result!.price).toBeCloseTo(1.11, 8);
  });

  it("spread on exit: a long's stop triggers on low - spread/2 <= stopLoss, even when the raw low doesn't touch it", () => {
    // Raw low is 1.0951, ABOVE the stop of 1.095 - but with a 10-point spread,
    // the bid low (1.0951 - 0.00005 = 1.09505) still doesn't reach it... use
    // a raw low that only breaches the stop once the bid adjustment applies.
    const fill = fillModel({ spreadPoints: 10, slippagePoints: 0 });
    const b = bar({ open: 1.1, high: 1.102, low: 1.09503, close: 1.1 }); // raw low > stop
    const noSpreadResult = exitOnBar(longPosition(), b, zeroCostFill, EURUSD);
    expect(noSpreadResult).toBeNull(); // without spread, this low never reaches the stop

    const withSpreadResult = exitOnBar(longPosition(), b, fill, EURUSD);
    expect(withSpreadResult).not.toBeNull(); // bid low = 1.09503 - 0.00005 = 1.09498 <= 1.095
    expect(withSpreadResult!.reason).toBe("STOP_LOSS");
  });

  it("with no stop loss set, only the target can trigger (never null-crashes on stop check)", () => {
    const b = bar({ open: 1.1, high: 1.09, low: 1.08, close: 1.085 }); // would have gapped a stop if one existed
    const result = exitOnBar(longPosition({ stopLoss: undefined }), b, zeroCostFill, EURUSD);
    expect(result).toBeNull();
  });

  it("slippage on a stop fill makes the realized price worse (lower) for a long", () => {
    const fill = fillModel({ spreadPoints: 0, slippagePoints: 5 });
    const b = bar({ open: 1.1, high: 1.101, low: 1.094, close: 1.096 });
    const result = exitOnBar(longPosition(), b, fill, EURUSD);
    // stop price 1.095 minus 5 points (0.00005) of slippage
    expect(result!.price).toBeCloseTo(1.09495, 8);
  });
});

describe("exitOnBar — short positions", () => {
  const zeroCostFill = fillModel({ spreadPoints: 0, slippagePoints: 0 });

  function shortPosition(overrides: Partial<SimPosition> = {}): SimPosition {
    return { side: "SHORT", lots: 1, entryTs: 0, entryPrice: 1.1, stopLoss: 1.105, takeProfit: 1.09, ...overrides };
  }

  it("returns null when neither level is touched", () => {
    const b = bar({ open: 1.1, high: 1.102, low: 1.098, close: 1.1 });
    expect(exitOnBar(shortPosition(), b, zeroCostFill, EURUSD)).toBeNull();
  });

  it("hits the stop when the high reaches it (price rose against the short)", () => {
    const b = bar({ open: 1.1, high: 1.106, low: 1.099, close: 1.104 });
    const result = exitOnBar(shortPosition(), b, zeroCostFill, EURUSD);
    expect(result!.reason).toBe("STOP_LOSS");
    expect(result!.price).toBeCloseTo(1.105, 8);
  });

  it("hits the target when the low reaches it (price fell in the short's favour)", () => {
    const b = bar({ open: 1.1, high: 1.101, low: 1.089, close: 1.091 });
    const result = exitOnBar(shortPosition(), b, zeroCostFill, EURUSD);
    expect(result!.reason).toBe("TAKE_PROFIT");
    expect(result!.price).toBeCloseTo(1.09, 8);
  });

  it("a gap through a short's stop fills at the open, at a worse (higher) price", () => {
    const b = bar({ open: 1.11, high: 1.115, low: 1.108, close: 1.112 });
    const result = exitOnBar(shortPosition(), b, zeroCostFill, EURUSD);
    expect(result!.reason).toBe("STOP_LOSS");
    expect(result!.price).toBeCloseTo(1.11, 8);
  });

  it("both levels in range, pessimisticFills true -> stop wins for a short too", () => {
    const pessimistic = fillModel({ spreadPoints: 0, slippagePoints: 0, pessimisticFills: true });
    const b = bar({ open: 1.1, high: 1.106, low: 1.089, close: 1.1 });
    const result = exitOnBar(shortPosition(), b, pessimistic, EURUSD);
    expect(result!.reason).toBe("STOP_LOSS");
  });

  it("both levels in range, pessimisticFills false -> target wins for a short", () => {
    const optimistic = fillModel({ spreadPoints: 0, slippagePoints: 0, pessimisticFills: false });
    const b = bar({ open: 1.1, high: 1.106, low: 1.089, close: 1.1 });
    const result = exitOnBar(shortPosition(), b, optimistic, EURUSD);
    expect(result!.reason).toBe("TAKE_PROFIT");
  });

  it("slippage on a short's stop fill makes the realized price worse (higher)", () => {
    const fill = fillModel({ spreadPoints: 0, slippagePoints: 5 });
    const b = bar({ open: 1.1, high: 1.106, low: 1.099, close: 1.104 });
    const result = exitOnBar(shortPosition(), b, fill, EURUSD);
    expect(result!.price).toBeCloseTo(1.10505, 8);
  });
});

describe("closeAtPrice", () => {
  it("computes pips, grossPnl, netPnl and rMultiple for a winning long", () => {
    const fill = fillModel({ commissionPerLot: 7 });
    const position: SimPosition = {
      side: "LONG",
      lots: 2,
      entryTs: 0,
      entryPrice: 1.1,
      stopLoss: 1.09,
      takeProfit: 1.12,
    };
    const trade = closeAtPrice(position, 1.11, 60_000, "TAKE_PROFIT", fill, EURUSD);

    expect(trade.pips).toBeCloseTo(100, 6);
    // pipValuePerLot = 0.0001 * 100000 * 1 = 10; grossPnl = 100 * 10 * 2 = 2000
    expect(trade.grossPnl).toBeCloseTo(2000, 6);
    // commission: both sides = 2 * 2 lots * 7 = 28
    expect(trade.commission).toBeCloseTo(28, 6);
    expect(trade.netPnl).toBeCloseTo(1972, 6);
    // riskAmount: |1.1-1.09|/0.0001 * 10 * 2 = 100*10*2 = 2000
    expect(trade.riskAmount).toBeCloseTo(2000, 6);
    expect(trade.rMultiple).toBeCloseTo(1972 / 2000, 6);
    expect(trade.holdingMinutes).toBe(1);
    expect(trade.exitReason).toBe("TAKE_PROFIT");
  });

  it("counts commission on both sides regardless of win/loss", () => {
    const fill = fillModel({ commissionPerLot: 5 });
    const position: SimPosition = { side: "SHORT", lots: 3, entryTs: 0, entryPrice: 1.1, stopLoss: 1.11 };
    const trade = closeAtPrice(position, 1.105, 0, "STOP_LOSS", fill, EURUSD);
    expect(trade.commission).toBeCloseTo(2 * 3 * 5, 6);
  });

  it("returns null rMultiple/riskAmount when there is no stop loss", () => {
    const fill = fillModel();
    const position: SimPosition = { side: "LONG", lots: 1, entryTs: 0, entryPrice: 1.1 };
    const trade = closeAtPrice(position, 1.105, 0, "SIGNAL", fill, EURUSD);
    expect(trade.riskAmount).toBeNull();
    expect(trade.rMultiple).toBeNull();
    // netPnl/grossPnl/pips are still fully computed even without a stop.
    expect(trade.pips).toBeCloseTo(50, 6);
    expect(trade.netPnl).toBeCloseTo(500, 6);
  });

  it("returns null rMultiple (not a crash) when entry equals the stop loss (zero risk)", () => {
    const fill = fillModel();
    const position: SimPosition = { side: "LONG", lots: 1, entryTs: 0, entryPrice: 1.1, stopLoss: 1.1 };
    const trade = closeAtPrice(position, 1.11, 0, "SIGNAL", fill, EURUSD);
    expect(trade.riskAmount).toBe(0);
    expect(trade.rMultiple).toBeNull();
  });

  it("computes a losing short trade correctly (negative netPnl, negative rMultiple)", () => {
    const fill = fillModel({ commissionPerLot: 0 });
    const position: SimPosition = { side: "SHORT", lots: 1, entryTs: 0, entryPrice: 1.1, stopLoss: 1.105 };
    const trade = closeAtPrice(position, 1.105, 0, "STOP_LOSS", fill, EURUSD);
    expect(trade.pips).toBeCloseTo(-50, 6);
    expect(trade.netPnl).toBeCloseTo(-500, 6);
    expect(trade.rMultiple).toBeCloseTo(-1, 6);
  });

  it("computes holdingMinutes from entryTs/exitTs", () => {
    const fill = fillModel();
    const position: SimPosition = { side: "LONG", lots: 1, entryTs: 1_000 * 60 * 5, entryPrice: 1.1 };
    const trade = closeAtPrice(position, 1.1, 1_000 * 60 * 95, "END_OF_DATA", fill, EURUSD);
    expect(trade.holdingMinutes).toBe(90);
  });

  it("applies a non-1 conversionRate to grossPnl/netPnl (quote currency != account currency)", () => {
    const fill = fillModel({ conversionRate: 0.5 });
    const position: SimPosition = { side: "LONG", lots: 1, entryTs: 0, entryPrice: 1.1 };
    const trade = closeAtPrice(position, 1.11, 0, "SIGNAL", fill, EURUSD);
    // pips=100, pipValuePerLot = 0.0001*100000*0.5=5, grossPnl=100*5*1=500
    expect(trade.grossPnl).toBeCloseTo(500, 6);
  });

  it("handles a JPY instrument (pipSize 0.01, 3 digits)", () => {
    const fill = fillModel();
    const position: SimPosition = { side: "LONG", lots: 1, entryTs: 0, entryPrice: 110, stopLoss: 109.5 };
    const trade = closeAtPrice(position, 110.5, 0, "SIGNAL", fill, USDJPY);
    expect(trade.pips).toBeCloseTo(50, 6);
    // pipValuePerLot = 0.01 * 100000 * 1 = 1000; grossPnl = 50*1000*1 = 50000
    expect(trade.grossPnl).toBeCloseTo(50_000, 6);
    expect(trade.riskAmount).toBeCloseTo(50 * 1000 * 1, 6);
  });

  it("handles XAUUSD (contractSize 100)", () => {
    const fill = fillModel();
    const position: SimPosition = { side: "LONG", lots: 1, entryTs: 0, entryPrice: 1900, stopLoss: 1890 };
    const trade = closeAtPrice(position, 1920, 0, "SIGNAL", fill, XAUUSD);
    // pips = (1920-1900)/0.01 = 2000; pipValuePerLot = 0.01*100*1 = 1; grossPnl = 2000*1*1=2000
    expect(trade.pips).toBeCloseTo(2000, 6);
    expect(trade.grossPnl).toBeCloseTo(2000, 6);
  });

  it("handles an index instrument (contractSize 1, pointSize 0.1)", () => {
    const fill = fillModel();
    const position: SimPosition = { side: "SHORT", lots: 2, entryTs: 0, entryPrice: 15000, stopLoss: 15050 };
    const trade = closeAtPrice(position, 14900, 0, "SIGNAL", fill, NAS100);
    // pips = (15000-14900)/0.1 = 1000 (favourable to short); pipValuePerLot=0.1*1*1=0.1
    // grossPnl = 1000*0.1*2 = 200
    expect(trade.pips).toBeCloseTo(1000, 6);
    expect(trade.grossPnl).toBeCloseTo(200, 6);
  });
});

describe("agreement with the live journal's computeTrade()", () => {
  it("a simulated trade handed to computeTrade() produces the same netPnl/pips/rMultiple", () => {
    const fill = fillModel({ commissionPerLot: 6, conversionRate: 1 });
    const position: SimPosition = {
      side: "LONG",
      lots: 1.5,
      entryTs: 0,
      entryPrice: 1.085,
      stopLoss: 1.08,
      takeProfit: 1.1,
    };
    const simTrade = closeAtPrice(position, 1.095, 45 * 60_000, "TAKE_PROFIT", fill, EURUSD);

    const instrumentSpec = {
      symbol: EURUSD.symbol,
      pipSize: EURUSD.pipSize,
      contractSize: EURUSD.contractSize,
      digits: EURUSD.digits,
      quoteCurrency: EURUSD.quoteCurrency,
      assetClass: "FX" as const,
    };

    const journalResult = computeTrade({
      instrument: instrumentSpec,
      direction: simTrade.side,
      entryPrice: simTrade.entryPrice,
      exitPrice: simTrade.exitPrice,
      stopLoss: simTrade.stopLoss,
      takeProfit: simTrade.takeProfit,
      volumeLots: simTrade.lots,
      commission: simTrade.commission,
      conversionRate: fill.conversionRate,
      openedAt: new Date(simTrade.entryTs),
      closedAt: new Date(simTrade.exitTs),
    });

    expect(journalResult.pips!.toNumber()).toBeCloseTo(simTrade.pips, 6);
    expect(journalResult.netPnl!.toNumber()).toBeCloseTo(simTrade.netPnl, 6);
    expect(journalResult.rMultiple!.toNumber()).toBeCloseTo(simTrade.rMultiple!, 6);
    expect(journalResult.holdingMinutes).toBe(simTrade.holdingMinutes);
  });

  it("agrees on a short, no-stop trade too (rMultiple both null)", () => {
    const fill = fillModel({ commissionPerLot: 0 });
    const position: SimPosition = { side: "SHORT", lots: 1, entryTs: 0, entryPrice: 1.2, takeProfit: 1.19 };
    const simTrade = closeAtPrice(position, 1.19, 30 * 60_000, "TAKE_PROFIT", fill, EURUSD);

    const instrumentSpec = {
      symbol: EURUSD.symbol,
      pipSize: EURUSD.pipSize,
      contractSize: EURUSD.contractSize,
      digits: EURUSD.digits,
      quoteCurrency: EURUSD.quoteCurrency,
      assetClass: "FX" as const,
    };

    const journalResult = computeTrade({
      instrument: instrumentSpec,
      direction: simTrade.side,
      entryPrice: simTrade.entryPrice,
      exitPrice: simTrade.exitPrice,
      volumeLots: simTrade.lots,
      commission: simTrade.commission,
      openedAt: new Date(simTrade.entryTs),
      closedAt: new Date(simTrade.exitTs),
    });

    expect(journalResult.netPnl!.toNumber()).toBeCloseTo(simTrade.netPnl, 6);
    expect(simTrade.rMultiple).toBeNull();
    expect(journalResult.rMultiple).toBeNull();
  });
});
