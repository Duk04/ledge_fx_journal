import { describe, expect, it, vi } from "vitest";
import { OandaError, estimatedBars, fetchOandaCandles, parseOandaCandles } from "./oanda";

const T0 = Date.UTC(2026, 2, 2, 0, 0); // Monday 2026-03-02 00:00 UTC

function candle(ts: number, close: number, complete = true) {
  return {
    complete,
    volume: 42,
    time: (ts / 1000).toFixed(9),
    bid: { o: "1.10000", h: "1.10100", l: "1.09900", c: close.toFixed(5) },
    ask: { o: "1.10010", h: "1.10110", l: "1.09910", c: (close + 0.00012).toFixed(5) },
  };
}

describe("parseOandaCandles", () => {
  it("keeps bid prices, derives the closing spread in points, and drops the forming bar", () => {
    const bars = parseOandaCandles({ candles: [candle(T0, 1.1005), candle(T0 + 900_000, 1.1007, false)] }, 0.00001);
    expect(bars).toEqual([{ ts: T0, open: 1.1, high: 1.101, low: 1.099, close: 1.1005, volume: 42, spread: 12 }]);
  });
});

describe("fetchOandaCandles", () => {
  it("asks for bid+ask on a UTC grid with the token, and stops on a short page", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ candles: [candle(T0, 1.1), candle(T0 + 900_000, 1.1)] }));
    const bars = await fetchOandaCandles({
      symbol: "EURUSD",
      timeframe: "M15",
      from: new Date(T0),
      to: new Date(T0 + 86_400_000),
      pointSize: 0.00001,
      token: "tok",
      fetchImpl,
    });
    expect(bars).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://api-fxpractice.oanda.com");
    expect(url.pathname).toBe("/v3/instruments/EUR_USD/candles");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      price: "BA",
      granularity: "M15",
      dailyAlignment: "0",
      alignmentTimezone: "UTC",
      weeklyAlignment: "Monday",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("pages 5000 at a time from after the last bar, and trims to the range", async () => {
    const page = (start: number, n: number) => Array.from({ length: n }, (_, i) => candle(start + i * 60_000, 1.1));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ candles: page(T0, 5000) }))
      .mockResolvedValueOnce(Response.json({ candles: page(T0 + 5000 * 60_000, 5000) }));
    const to = T0 + 7000 * 60_000;
    const bars = await fetchOandaCandles({
      symbol: "EURUSD",
      timeframe: "M1",
      from: new Date(T0),
      to: new Date(to),
      pointSize: 0.00001,
      token: "tok",
      fetchImpl,
    });
    expect(bars).toHaveLength(7000);
    expect(bars.at(-1)!.ts).toBeLessThan(to);
    const second = fetchImpl.mock.calls[1][0] as URL;
    expect(Number(second.searchParams.get("from")) * 1000).toBe(T0 + 4999 * 60_000 + 1);
  });

  it("surfaces OANDA's own error message", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ errorMessage: "Insufficient authorization to perform request." }, { status: 401 }),
    );
    await expect(
      fetchOandaCandles({
        symbol: "EURUSD",
        timeframe: "H1",
        from: new Date(T0),
        to: new Date(T0 + 86_400_000),
        pointSize: 0.00001,
        token: "bad",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ status: 401, message: "Insufficient authorization to perform request." });
  });

  it("refuses an unmapped symbol without calling out", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchOandaCandles({
        symbol: "DOGEUSD",
        timeframe: "H1",
        from: new Date(T0),
        to: new Date(T0 + 1),
        pointSize: 0.00001,
        token: "tok",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OandaError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("estimatedBars", () => {
  it("is the calendar span over the bar size", () => {
    expect(estimatedBars("M15", new Date(T0), new Date(T0 + 86_400_000))).toBe(96);
    expect(estimatedBars("D1", new Date(T0), new Date(T0 + 30 * 86_400_000))).toBe(30);
  });
});
