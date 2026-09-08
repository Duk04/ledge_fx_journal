import { describe, expect, it } from "vitest";
import { aggregateBars } from "./aggregate";
import type { Bar } from "@/lib/backtest/types";

function m1(
  minutesFromEpoch: number,
  o: number,
  h: number,
  l: number,
  c: number,
  volume?: number,
  spread?: number,
): Bar {
  return { ts: minutesFromEpoch * 60_000, open: o, high: h, low: l, close: c, volume, spread };
}

describe("aggregateBars — OHLCV rules", () => {
  it("open is the first bar's open, close is the last bar's close", () => {
    const bars = [m1(0, 1.1, 1.12, 1.09, 1.11), m1(1, 1.11, 1.13, 1.1, 1.12), m1(2, 1.12, 1.14, 1.11, 1.13)];
    const [out] = aggregateBars(bars, "M1", "M5");
    expect(out.open).toBe(1.1);
    expect(out.close).toBe(1.13);
  });

  it("high is the max across the bucket, low is the min", () => {
    const bars = [m1(0, 1.1, 1.12, 1.09, 1.11), m1(1, 1.11, 1.2, 1.05, 1.12), m1(2, 1.12, 1.14, 1.11, 1.13)];
    const [out] = aggregateBars(bars, "M1", "M5");
    expect(out.high).toBe(1.2);
    expect(out.low).toBe(1.05);
  });

  it("volume sums across the bucket", () => {
    const bars = [m1(0, 1, 1, 1, 1, 100), m1(1, 1, 1, 1, 1, 50), m1(2, 1, 1, 1, 1, 25)];
    const [out] = aggregateBars(bars, "M1", "M5");
    expect(out.volume).toBe(175);
  });

  it("volume is left undefined when no source bar carried one", () => {
    const bars = [m1(0, 1, 1, 1, 1), m1(1, 1, 1, 1, 1)];
    const [out] = aggregateBars(bars, "M1", "M5");
    expect(out.volume).toBeUndefined();
  });

  it("spread is the max across the bucket, not the sum or the last value", () => {
    const bars = [m1(0, 1, 1, 1, 1, undefined, 5), m1(1, 1, 1, 1, 1, undefined, 9), m1(2, 1, 1, 1, 1, undefined, 3)];
    const [out] = aggregateBars(bars, "M1", "M5");
    expect(out.spread).toBe(9);
  });
});

describe("aggregateBars — calendar alignment (UTC)", () => {
  it("aligns H4 buckets to 00/04/08/... UTC regardless of the first bar's own timestamp", () => {
    // First bar lands at 01:17 UTC — an unaligned aggregator would start a
    // bucket there; a calendar-aligned one snaps to the 00:00 bucket.
    const start = Date.UTC(2024, 0, 10, 1, 17);
    const bars: Bar[] = [
      { ts: start, open: 1, high: 1, low: 1, close: 1 },
      { ts: start + 60_000, open: 1, high: 1, low: 1, close: 1 },
    ];
    const [out] = aggregateBars(bars, "M1", "H4");
    expect(out.ts).toBe(Date.UTC(2024, 0, 10, 0, 0, 0));
  });

  it("splits bars either side of an H4 boundary into two buckets", () => {
    const justBefore = Date.UTC(2024, 0, 10, 3, 59);
    const justAfter = Date.UTC(2024, 0, 10, 4, 0);
    const bars: Bar[] = [
      { ts: justBefore, open: 1, high: 1, low: 1, close: 1 },
      { ts: justAfter, open: 2, high: 2, low: 2, close: 2 },
    ];
    const out = aggregateBars(bars, "M1", "H4");
    expect(out).toHaveLength(2);
    expect(out[0].ts).toBe(Date.UTC(2024, 0, 10, 0, 0, 0));
    expect(out[1].ts).toBe(Date.UTC(2024, 0, 10, 4, 0, 0));
  });

  it("aligns D1 buckets to UTC midnight", () => {
    const bars: Bar[] = [{ ts: Date.UTC(2024, 0, 10, 17, 30), open: 1, high: 1, low: 1, close: 1 }];
    const [out] = aggregateBars(bars, "H1", "D1");
    expect(out.ts).toBe(Date.UTC(2024, 0, 10, 0, 0, 0));
  });

  it("aligns W1 buckets to Monday 00:00 UTC", () => {
    // 2024-01-10 is a Wednesday; the containing week starts Monday 2024-01-08.
    const bars: Bar[] = [{ ts: Date.UTC(2024, 0, 10, 12, 0), open: 1, high: 1, low: 1, close: 1 }];
    const [out] = aggregateBars(bars, "D1", "W1");
    expect(out.ts).toBe(Date.UTC(2024, 0, 8, 0, 0, 0));
  });

  it("a bar landing exactly on a Monday maps to itself", () => {
    const monday = Date.UTC(2024, 0, 8, 0, 0, 0);
    const bars: Bar[] = [{ ts: monday, open: 1, high: 1, low: 1, close: 1 }];
    const [out] = aggregateBars(bars, "D1", "W1");
    expect(out.ts).toBe(monday);
  });
});

describe("aggregateBars — gap handling", () => {
  it("does not emit a bucket for a weekend with no source bars", () => {
    // Friday close and the following Monday open, nothing in between.
    const friday = Date.UTC(2024, 0, 12, 20, 0);
    const monday = Date.UTC(2024, 0, 15, 0, 0);
    const bars: Bar[] = [
      { ts: friday, open: 1, high: 1, low: 1, close: 1 },
      { ts: monday, open: 2, high: 2, low: 2, close: 2 },
    ];
    const out = aggregateBars(bars, "H4", "D1");
    // Only the two days that actually have data appear — nothing for
    // 2024-01-13/14 (Sat/Sun).
    expect(out.map((b) => b.ts)).toEqual([Date.UTC(2024, 0, 12, 0, 0, 0), Date.UTC(2024, 0, 15, 0, 0, 0)]);
  });

  it("output length reflects only populated buckets, not the full span between first and last", () => {
    const bars: Bar[] = [
      { ts: Date.UTC(2024, 0, 1, 0, 0), open: 1, high: 1, low: 1, close: 1 },
      { ts: Date.UTC(2024, 0, 30, 0, 0), open: 2, high: 2, low: 2, close: 2 },
    ];
    const out = aggregateBars(bars, "D1", "W1");
    expect(out.length).toBeLessThan(5); // a naive full-span fill would emit ~5 weekly buckets either way; still, no empty ones
    expect(out.every((b) => Number.isFinite(b.open))).toBe(true);
  });
});

describe("aggregateBars — timeframe ordering rules", () => {
  it("refuses to aggregate into a finer timeframe", () => {
    const bars: Bar[] = [{ ts: 0, open: 1, high: 1, low: 1, close: 1 }];
    expect(() => aggregateBars(bars, "H1", "M15")).toThrow();
  });

  it("is a no-op (returns an equivalent copy) when from === to", () => {
    const bars: Bar[] = [{ ts: 0, open: 1, high: 1, low: 1, close: 1 }];
    const out = aggregateBars(bars, "H1", "H1");
    expect(out).toEqual(bars);
    expect(out).not.toBe(bars);
  });

  it("returns an empty array for empty input", () => {
    expect(aggregateBars([], "M1", "H1")).toEqual([]);
  });

  it("does not mutate the input array's order", () => {
    const bars: Bar[] = [
      { ts: 120_000, open: 1, high: 1, low: 1, close: 1 },
      { ts: 0, open: 2, high: 2, low: 2, close: 2 },
    ];
    const copy = [...bars];
    aggregateBars(bars, "M1", "H1");
    expect(bars).toEqual(copy);
  });

  it("sorts out-of-order input before bucketing", () => {
    const bars: Bar[] = [
      { ts: 60_000, open: 2, high: 2, low: 2, close: 2 },
      { ts: 0, open: 1, high: 1, low: 1, close: 1 },
    ];
    const [out] = aggregateBars(bars, "M1", "H1");
    expect(out.open).toBe(1); // the ts:0 bar, not whichever came first in the array
    expect(out.close).toBe(2);
  });
});

describe("aggregateBars — M1 to H1 realistic run", () => {
  it("produces one H1 bar per 60 M1 bars for a full clean hour", () => {
    const start = Date.UTC(2024, 0, 10, 8, 0);
    const bars: Bar[] = Array.from({ length: 60 }, (_, i) => ({
      ts: start + i * 60_000,
      open: 1 + i * 0.0001,
      high: 1 + i * 0.0001 + 0.0002,
      low: 1 + i * 0.0001 - 0.0002,
      close: 1 + i * 0.0001,
      volume: 1,
    }));
    const out = aggregateBars(bars, "M1", "H1");
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe(start);
    expect(out[0].open).toBe(bars[0].open);
    expect(out[0].close).toBe(bars[59].close);
    expect(out[0].volume).toBe(60);
  });
});
