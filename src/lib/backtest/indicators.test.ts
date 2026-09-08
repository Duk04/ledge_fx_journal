import { describe, expect, it } from "vitest";
import { atr, crossOver, crossUnder, ema, highest, lowest, rsi, sma, stdev } from "./indicators";

// Every expectation below is hand-computed in the task's working notes, not
// checked against another implementation — see the module doc for why that
// matters (an indicator is a look-alike bug magnet if it merely agrees with
// itself under refactor).

describe("sma", () => {
  const values = [1, 2, 3, 4, 5];

  it("is null through the warm-up period", () => {
    const out = sma(values, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
  });

  it("matches a hand-computed rolling average from index period-1 onward", () => {
    const out = sma(values, 3);
    expect(out[2]).toBeCloseTo(2, 10); // (1+2+3)/3
    expect(out[3]).toBeCloseTo(3, 10); // (2+3+4)/3
    expect(out[4]).toBeCloseTo(4, 10); // (3+4+5)/3
  });

  it("returns an array the same length as the input, never shorter", () => {
    expect(sma(values, 3)).toHaveLength(values.length);
    expect(sma(values, 5)).toHaveLength(values.length);
  });

  it("throws on a non-positive-integer period", () => {
    expect(() => sma(values, 0)).toThrow();
    expect(() => sma(values, 1.5)).toThrow();
  });
});

describe("ema", () => {
  const values = [1, 2, 3, 4, 5, 6];

  it("is null through the warm-up period", () => {
    const out = ema(values, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
  });

  it("seeds at period-1 with the simple average, then recurses with k = 2/(period+1)", () => {
    const out = ema(values, 3);
    // k = 0.5. seed = (1+2+3)/3 = 2
    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[3]).toBeCloseTo(3, 10); // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4, 10); // 5*0.5 + 3*0.5
    expect(out[5]).toBeCloseTo(5, 10); // 6*0.5 + 4*0.5
  });

  it("is all null when there is not enough data for even one seed", () => {
    const out = ema([1, 2], 5);
    expect(out).toEqual([null, null]);
  });
});

describe("rsi", () => {
  // values: [1, 2, 1, 2, 3, 2], period 3.
  // deltas (index1..5): +1, -1, +1, +1, -1
  const values = [1, 2, 1, 2, 3, 2];

  it("is null through the warm-up period (needs `period` deltas)", () => {
    const out = rsi(values, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
  });

  it("matches hand-computed Wilder RSI values", () => {
    const out = rsi(values, 3);
    // seed avgGain = (1+0+1)/3 = 0.6667, avgLoss = (0+1+0)/3 = 0.3333
    // RSI = 100 - 100/(1+2) = 66.667
    expect(out[3]).toBeCloseTo(66.667, 2);
    // avgGain = (0.6667*2+1)/3 = 0.7778, avgLoss = (0.3333*2+0)/3 = 0.2222
    // RSI = 100 - 100/(1+3.5) = 77.778
    expect(out[4]).toBeCloseTo(77.778, 2);
    // avgGain = (0.7778*2+0)/3 = 0.5185, avgLoss = (0.2222*2+1)/3 = 0.4815
    // RSI = 100 - 100/(1+1.0769) = 51.852
    expect(out[5]).toBeCloseTo(51.852, 2);
  });

  it("returns 100 when losses are zero (monotonically rising prices)", () => {
    const out = rsi([1, 2, 3, 4, 5], 3);
    expect(out[3]).toBe(100);
  });

  it("returns 50 for perfectly flat prices (no gains, no losses)", () => {
    const out = rsi([5, 5, 5, 5, 5], 3);
    expect(out[3]).toBe(50);
  });
});

describe("atr", () => {
  const high = [10, 12, 11, 13, 14];
  const low = [8, 9, 9, 11, 12];
  const close = [9, 11, 10, 12, 13];

  it("is null through the warm-up period", () => {
    const out = atr(high, low, close, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
  });

  it("matches hand-computed true ranges and Wilder smoothing", () => {
    const out = atr(high, low, close, 3);
    // TR: [2, 3, 2, 3, 2]; seed at idx2 = (2+3+2)/3 = 2.3333
    expect(out[2]).toBeCloseTo(2.3333, 3);
    // ATR[3] = (2.3333*2+3)/3 = 2.5556
    expect(out[3]).toBeCloseTo(2.5556, 3);
    // ATR[4] = (2.5556*2+2)/3 = 2.3704
    expect(out[4]).toBeCloseTo(2.3704, 3);
  });

  it("bar 0's true range is just high-low (no previous close)", () => {
    // Confirm indirectly via the seed average, which includes TR[0] = 2.
    const out = atr([10], [8], [9], 1);
    expect(out[0]).toBeCloseTo(2, 10);
  });
});

describe("stdev", () => {
  it("is null through the warm-up period", () => {
    const out = stdev([1, 2, 4, 4], 2);
    expect(out[0]).toBeNull();
  });

  it("matches hand-computed rolling POPULATION standard deviation", () => {
    const out = stdev([1, 2, 4, 4], 2);
    expect(out[1]).toBeCloseTo(0.5, 8); // window [1,2]: mean 1.5, popvar 0.25
    expect(out[2]).toBeCloseTo(1, 8); // window [2,4]: mean 3, popvar 1
    expect(out[3]).toBeCloseTo(0, 8); // window [4,4]: mean 4, popvar 0
  });
});

describe("highest / lowest", () => {
  const values = [3, 1, 4, 1, 5, 9, 2, 6];

  it("are null through the warm-up period", () => {
    expect(highest(values, 3)[0]).toBeNull();
    expect(highest(values, 3)[1]).toBeNull();
    expect(lowest(values, 3)[0]).toBeNull();
  });

  it("match a hand-computed rolling max/min", () => {
    const hi = highest(values, 3);
    const lo = lowest(values, 3);
    expect(hi[2]).toBe(4); // [3,1,4]
    expect(hi[3]).toBe(4); // [1,4,1]
    expect(hi[4]).toBe(5); // [4,1,5]
    expect(hi[5]).toBe(9); // [1,5,9]
    expect(hi[6]).toBe(9); // [5,9,2]
    expect(hi[7]).toBe(9); // [9,2,6]

    expect(lo[2]).toBe(1);
    expect(lo[3]).toBe(1);
    expect(lo[4]).toBe(1);
    expect(lo[5]).toBe(1);
    expect(lo[6]).toBe(2);
    expect(lo[7]).toBe(2);
  });
});

describe("crossOver / crossUnder", () => {
  const a = [1, 3, 1, 3];
  const b = [2, 2, 2, 2];

  it("reports false at index 0 (no prior bar to compare against)", () => {
    expect(crossOver(a, b)[0]).toBe(false);
    expect(crossUnder(a, b)[0]).toBe(false);
  });

  it("detects an upward cross exactly where a rises through b", () => {
    const up = crossOver(a, b);
    expect(up).toEqual([false, true, false, true]);
  });

  it("detects a downward cross exactly where a falls through b", () => {
    const down = crossUnder(a, b);
    expect(down).toEqual([false, false, true, false]);
  });

  it("never reports a cross where the PREVIOUS bar is still in warm-up (null)", () => {
    const withNulls = [null, null, 5, 1];
    const other = [2, 2, 2, 2];
    const up = crossOver(withNulls, other);
    const down = crossUnder(withNulls, other);
    expect(up[1]).toBe(false); // prev (index 0) is null -> no event, not an unknown
    expect(down[1]).toBe(false);
  });

  it("a real cross-under still fires once both surrounding values are defined", () => {
    const withNulls = [null, 5, 1];
    const other = [2, 2, 2];
    const down = crossUnder(withNulls, other);
    expect(down[2]).toBe(true); // prev(5>=2) true, cur(1<2) true
  });
});
