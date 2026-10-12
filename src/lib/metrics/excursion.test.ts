import { describe, expect, it } from "vitest";
import { excursionFromBars, excursionInR, type ExcursionBar } from "./excursion";

const at = (hhmm: string) => new Date(`2026-03-04T${hhmm}:00Z`);
const bar = (hhmm: string, high: string, low: string): ExcursionBar => ({ ts: at(hhmm), high, low });
const long = {
  direction: "LONG" as const,
  entryPrice: "1.1000",
  exitPrice: "1.1020",
  openedAt: new Date("2026-03-04T10:00:30Z"),
  closedAt: new Date("2026-03-04T10:05:20Z"),
};

describe("excursionFromBars", () => {
  it("reads only bars wholly inside the holding period", () => {
    const bars = [
      bar("10:00", "1.1100", "1.0900"), // entry bar: has pre-fill prices — ignored
      bar("10:01", "1.1005", "1.0990"),
      bar("10:02", "1.1030", "1.0995"),
      bar("10:03", "1.1025", "1.1000"),
      bar("10:04", "1.1022", "1.1010"),
      bar("10:05", "1.1200", "1.0800"), // exit bar: has post-exit prices — ignored
    ];
    const e = excursionFromBars(long, bars)!;
    expect(e.maePrice.toString()).toBe("1.099");
    expect(e.mfePrice.toString()).toBe("1.103");
    expect(e.barsUsed).toBe(4);
  });

  it("swaps adverse and favourable for a short", () => {
    const e = excursionFromBars({ ...long, direction: "SHORT", exitPrice: "1.0980" }, [
      bar("10:01", "1.1015", "1.0990"),
      bar("10:02", "1.1000", "1.0970"),
      bar("10:03", "1.0990", "1.0975"),
      bar("10:04", "1.0985", "1.0978"),
    ])!;
    expect(e.maePrice.toString()).toBe("1.1015");
    expect(e.mfePrice.toString()).toBe("1.097");
  });

  it("refuses to guess when the candles don't cover the trade", () => {
    expect(excursionFromBars(long, [])).toBeNull();
    expect(
      excursionFromBars({ ...long, closedAt: new Date("2026-03-04T11:00:00Z") }, [bar("10:01", "1.1", "1.1")]),
    ).toBeNull();
  });

  it("a trade inside one minute is just its entry and exit", () => {
    const e = excursionFromBars({ ...long, closedAt: new Date("2026-03-04T10:00:50Z") }, [])!;
    expect([e.maePrice.toString(), e.mfePrice.toString()]).toEqual(["1.1", "1.102"]);
  });
});

describe("excursionInR", () => {
  it("expresses excursion against the initial stop", () => {
    const r = excursionInR({
      direction: "LONG",
      entryPrice: "1.1000",
      riskStop: "1.0990",
      maePrice: "1.0995",
      mfePrice: "1.1030",
    });
    expect(r.maeR!.toString()).toBe("-0.5");
    expect(r.mfeR!.toString()).toBe("3");
  });

  it("is null without a stop", () => {
    expect(
      excursionInR({ direction: "LONG", entryPrice: "1.1", riskStop: null, maePrice: "1", mfePrice: "2" }),
    ).toEqual({
      maeR: null,
      mfeR: null,
    });
  });
});
