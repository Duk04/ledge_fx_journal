import { describe, expect, it } from "vitest";
import { runBacktest, toJournalTrade } from "./runner";
import type { Bar, BacktestConfig, FillModel, SimInstrument, StrategyContext, StrategyModule } from "./types";

const EURUSD: SimInstrument = {
  symbol: "EURUSD",
  digits: 5,
  pipSize: 0.0001,
  contractSize: 100_000,
  quoteCurrency: "USD",
  pointSize: 0.00001,
};

function noCostFill(overrides: Partial<FillModel> = {}): FillModel {
  return {
    spreadPoints: 0,
    commissionPerLot: 0,
    slippagePoints: 0,
    pessimisticFills: true,
    conversionRate: 1,
    ...overrides,
  };
}

function baseConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    instrument: EURUSD,
    fill: noCostFill(),
    initialBalance: 10_000,
    ...overrides,
  };
}

const MINUTE = 60_000;

/** Flat bars at `price` unless overridden per-index via `overrides`. */
function makeBars(count: number, price: number, overrides: Record<number, Partial<Bar>> = {}): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    bars.push({ ts: i * MINUTE, open: price, high: price, low: price, close: price, ...overrides[i] });
  }
  return bars;
}

describe("runBacktest — buy and hold", () => {
  it("a strategy that buys once on the first bar and never closes ends up force-closed at END_OF_DATA", () => {
    const bars = makeBars(5, 1.1);
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 0 && !ctx.position) ctx.buy({ lots: 1, reason: "go long" });
      },
    };

    const result = runBacktest(bars, strategy, baseConfig());

    expect(result.error).toBeUndefined();
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("END_OF_DATA");
    expect(result.trades[0].side).toBe("LONG");
    expect(result.barsProcessed).toBe(5);
  });

  it("fills the order at the NEXT bar's open, not the signal bar's own price", () => {
    const bars = makeBars(4, 1.1, { 1: { open: 1.2, high: 1.2, low: 1.2, close: 1.2 } });
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 0 && !ctx.position) ctx.buy({ lots: 1 });
      },
    };

    const result = runBacktest(bars, strategy, baseConfig());
    // bar 1's open is 1.2 (zero spread/slippage fill model) - NOT bar 0's close (1.1).
    expect(result.trades[0].entryPrice).toBeCloseTo(1.2, 8);
    expect(result.trades[0].entryTs).toBe(bars[1].ts);
  });

  it("an order requested on the LAST bar never fills", () => {
    const bars = makeBars(3, 1.1);
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === bars.length - 1 && !ctx.position) ctx.buy({ lots: 1 });
      },
    };

    const result = runBacktest(bars, strategy, baseConfig());
    expect(result.trades).toHaveLength(0);
  });
});

describe("runBacktest — stop loss", () => {
  it("gets stopped out when a later bar's low reaches the stop", () => {
    const bars = makeBars(5, 1.1, {
      3: { open: 1.1, high: 1.1, low: 1.05, close: 1.06 }, // stop breached here
    });
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 0 && !ctx.position) ctx.buy({ lots: 1, stopLoss: 1.08 });
      },
    };

    const result = runBacktest(bars, strategy, baseConfig());
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("STOP_LOSS");
    expect(result.trades[0].exitPrice).toBeCloseTo(1.08, 8);
    expect(result.trades[0].netPnl).toBeLessThan(0);
  });

  it("an exit always precedes a new signal on the same bar (one trade, not a re-entry same bar)", () => {
    const bars = makeBars(5, 1.1, {
      2: { open: 1.1, high: 1.1, low: 1.05, close: 1.06 },
    });
    let buyAttemptsAfterStop = 0;
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (!ctx.position) {
          ctx.buy({ lots: 1, stopLoss: 1.08 });
          if (ctx.i > 0) buyAttemptsAfterStop++;
        }
      },
    };

    const result = runBacktest(bars, strategy, baseConfig());
    // Position opens at bar1 open, stops out on bar2's range check (before
    // strategy runs for bar2), then a NEW buy is placed on bar2 (since
    // ctx.position is null again) which fills at bar3's open.
    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    expect(result.trades[0].exitReason).toBe("STOP_LOSS");
    expect(buyAttemptsAfterStop).toBeGreaterThan(0);
  });
});

describe("runBacktest — no-lookahead guarantee", () => {
  it("bars[i+1] is genuinely undefined inside onBar, never the future bar", () => {
    const bars = makeBars(5, 1.1);
    const seen: (Bar | undefined)[] = [];
    const strategy: StrategyModule = {
      onBar(ctx) {
        seen.push(ctx.bars[ctx.i + 1]);
      },
    };

    runBacktest(bars, strategy, baseConfig());
    expect(seen).toHaveLength(5);
    for (const future of seen) expect(future).toBeUndefined();
  });

  it("ctx.bars has length exactly i+1 on every bar", () => {
    const bars = makeBars(6, 1.1);
    const lengths: number[] = [];
    const strategy: StrategyModule = {
      onBar(ctx) {
        lengths.push(ctx.bars.length);
      },
    };
    runBacktest(bars, strategy, baseConfig());
    expect(lengths).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("ctx.bars is frozen — mutating it throws or silently no-ops, but never lets old data change", () => {
    const bars = makeBars(3, 1.1);
    let frozenCheck: boolean | undefined;
    const strategy: StrategyModule = {
      onBar(ctx) {
        frozenCheck = Object.isFrozen(ctx.bars);
      },
    };
    runBacktest(bars, strategy, baseConfig());
    expect(frozenCheck).toBe(true);
  });
});

describe("runBacktest — end of data", () => {
  it("closes an open position at the final bar's close (market-crossing, not the raw close)", () => {
    const bars = makeBars(4, 1.1, { 3: { open: 1.1, high: 1.15, low: 1.1, close: 1.15 } });
    const fill = noCostFill({ spreadPoints: 10 });
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 0 && !ctx.position) ctx.buy({ lots: 1 });
      },
    };

    const result = runBacktest(bars, strategy, baseConfig({ fill }));
    expect(result.trades[0].exitReason).toBe("END_OF_DATA");
    expect(result.trades[0].exitTs).toBe(bars[3].ts);
    // Closing a long crosses the spread (bid), so strictly less than the raw close of 1.15.
    expect(result.trades[0].exitPrice).toBeLessThan(1.15);
  });

  it("with no position ever opened, produces zero trades and an unchanged balance", () => {
    const bars = makeBars(4, 1.1);
    const strategy: StrategyModule = { onBar() {} };
    const result = runBacktest(bars, strategy, baseConfig({ initialBalance: 5000 }));
    expect(result.trades).toHaveLength(0);
    expect(result.equity[result.equity.length - 1].balance).toBe(5000);
  });
});

describe("runBacktest — one position at a time", () => {
  it("a second buy while a position is open is silently ignored", () => {
    const bars = makeBars(5, 1.1);
    let buyCallCount = 0;
    const strategy: StrategyModule = {
      onBar(ctx) {
        buyCallCount++;
        ctx.buy({ lots: 1 });
      },
    };
    const result = runBacktest(bars, strategy, baseConfig());
    expect(buyCallCount).toBe(5);
    expect(result.trades).toHaveLength(1); // only ever one position, so only one eventual close
  });
});

describe("runBacktest — timeout and hard caps", () => {
  it("stops cleanly and sets `error` when the strategy exceeds timeoutMs", () => {
    const bars = makeBars(2000, 1.1);
    const strategy: StrategyModule = {
      onBar() {
        const start = Date.now();
        while (Date.now() - start < 2) {
          /* busy-wait to burn wall-clock time per bar */
        }
      },
    };
    const result = runBacktest(bars, strategy, baseConfig({ timeoutMs: 15 }));
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/timed out/i);
    expect(result.barsProcessed).toBeLessThan(2000);
    expect(result.barsProcessed).toBeGreaterThan(0);
  });

  it("a strategy that throws stops the run and reports the error without crashing the caller", () => {
    const bars = makeBars(5, 1.1);
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 2) throw new Error("boom");
      },
    };
    const result = runBacktest(bars, strategy, baseConfig());
    expect(result.error).toMatch(/boom/);
    expect(result.barsProcessed).toBe(3);
  });

  it("caps logs at 500 entries even if the strategy logs far more", () => {
    const bars = makeBars(600, 1.1);
    const strategy: StrategyModule = {
      onBar(ctx) {
        ctx.log(`bar ${ctx.i}`);
      },
    };
    const result = runBacktest(bars, strategy, baseConfig());
    expect(result.logs.length).toBe(500);
  });
});

describe("runBacktest — equity series", () => {
  it("starts with the initial balance and adds one point per closed trade", () => {
    const bars = makeBars(3, 1.1);
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 0 && !ctx.position) ctx.buy({ lots: 1 });
      },
    };
    const result = runBacktest(bars, strategy, baseConfig({ initialBalance: 1000 }));
    expect(result.equity[0]).toEqual({ ts: bars[0].ts, balance: 1000 });
    expect(result.equity).toHaveLength(2); // seed + one closed trade
    expect(result.equity[1].balance).toBeCloseTo(1000 + result.trades[0].netPnl, 6);
  });

  it("accumulates balance correctly across two trades", () => {
    // Trade 1: opened at bar1's open (1.1, unmodified), closed at bar4's
    // open (1.2) -> a win. Trade 2: opened at bar5's open (1.1,
    // unmodified), closed at bar8's open (1.05) -> a loss.
    const bars = makeBars(9, 1.1, {
      4: { open: 1.2, high: 1.2, low: 1.2, close: 1.2 },
      8: { open: 1.05, high: 1.05, low: 1.05, close: 1.05 },
    });
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (!ctx.position && (ctx.i === 0 || ctx.i === 4)) {
          ctx.buy({ lots: 1 });
        } else if (ctx.position && (ctx.i === 3 || ctx.i === 7)) {
          ctx.close("scheduled exit");
        }
      },
    };
    const result = runBacktest(bars, strategy, baseConfig({ initialBalance: 2000 }));
    expect(result.trades).toHaveLength(2);
    expect(result.equity).toHaveLength(3);
    const runningBalance = result.equity.map((p) => p.balance);
    expect(runningBalance[1]).toBeCloseTo(2000 + result.trades[0].netPnl, 6);
    expect(runningBalance[2]).toBeCloseTo(2000 + result.trades[0].netPnl + result.trades[1].netPnl, 6);
  });
});

describe("runBacktest — modify()", () => {
  it("moves the stop loss immediately, affecting the NEXT bar's check, not the current one", () => {
    const bars = makeBars(5, 1.1, {
      2: { open: 1.1, high: 1.1, low: 1.07, close: 1.08 }, // hits the MODIFIED stop (1.075) but not the original (1.06)
      3: { open: 1.08, high: 1.08, low: 1.04, close: 1.05 },
    });
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 0 && !ctx.position) {
          ctx.buy({ lots: 1, stopLoss: 1.06 });
        } else if (ctx.position && ctx.i === 1) {
          ctx.modify({ stopLoss: 1.075 });
        }
      },
    };
    const result = runBacktest(bars, strategy, baseConfig());
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].stopLoss).toBe(1.075);
    expect(result.trades[0].exitReason).toBe("STOP_LOSS");
  });
});

describe("runBacktest — init()", () => {
  it("calls init() once before the first bar, with instrument/params/log but no position", () => {
    let initCalls = 0;
    let sawParams: unknown;
    const strategy: StrategyModule = {
      init(ctx) {
        initCalls++;
        sawParams = ctx.params;
        ctx.log("initialized");
      },
      onBar() {},
    };
    const bars = makeBars(3, 1.1);
    const result = runBacktest(bars, strategy, baseConfig({ params: { fast: 10 } }));
    expect(initCalls).toBe(1);
    expect(sawParams).toEqual({ fast: 10 });
    expect(result.logs).toContain("initialized");
  });
});

describe("toJournalTrade", () => {
  it("produces the exact field set prisma.trade.create needs, with Decimal columns as strings", () => {
    const bars = makeBars(3, 1.1);
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 0 && !ctx.position) ctx.buy({ lots: 1.5, stopLoss: 1.05, takeProfit: 1.2, reason: "test" });
      },
    };
    const result = runBacktest(bars, strategy, baseConfig());
    const simTrade = result.trades[0];

    const journalTrade = toJournalTrade(simTrade, { accountId: "acct-1", symbol: "EURUSD", backtestRunId: "run-1" });

    expect(journalTrade.accountId).toBe("acct-1");
    expect(journalTrade.symbol).toBe("EURUSD");
    expect(journalTrade.status).toBe("CLOSED");
    expect(journalTrade.direction).toBe("LONG");
    expect(typeof journalTrade.entryPrice).toBe("string");
    expect(typeof journalTrade.exitPrice).toBe("string");
    expect(typeof journalTrade.volumeLots).toBe("string");
    expect(typeof journalTrade.commission).toBe("string");
    expect(typeof journalTrade.netPnl).toBe("string");
    expect(typeof journalTrade.pips).toBe("string");
    expect(journalTrade.holdingMinutes).toBe(simTrade.holdingMinutes);
    expect(journalTrade.backtestRunId).toBe("run-1");
    expect(journalTrade.openedAt.getTime()).toBe(simTrade.entryTs);
    expect(journalTrade.closedAt.getTime()).toBe(simTrade.exitTs);
    expect(journalTrade.marketSession).toBeDefined();
  });

  it("passes through null rMultiple/riskAmount (not the string 'null') when there was no stop", () => {
    const bars = makeBars(3, 1.1);
    const strategy: StrategyModule = {
      onBar(ctx) {
        if (ctx.i === 0 && !ctx.position) ctx.buy({ lots: 1 });
      },
    };
    const result = runBacktest(bars, strategy, baseConfig());
    const journalTrade = toJournalTrade(result.trades[0], { accountId: "a", symbol: "EURUSD" });
    expect(journalTrade.rMultiple).toBeNull();
    expect(journalTrade.riskAmount).toBeNull();
    expect(journalTrade.stopLoss).toBeUndefined();
  });
});

// Type-level sanity check (not a runtime assertion): StrategyContext's shape
// compiles as documented. Left here so a future change to types.ts that
// breaks the strategy-authoring API is caught at tsc time, not just at
// runtime.
function _typeCheckOnly(ctx: StrategyContext): void {
  ctx.buy({ lots: 1 });
  ctx.sell({ lots: 1 });
  ctx.close();
  ctx.modify({ stopLoss: 1 });
  ctx.log("x");
  void ctx.equity;
  void ctx.balance;
}
void _typeCheckOnly;
