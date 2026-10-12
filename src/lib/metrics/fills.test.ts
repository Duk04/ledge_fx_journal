import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { aggregateFills, simpleFills, validateFills, type Fill } from "./fills";
import { computeTrade } from "./trade";
import type { TradeInput } from "./types";

const t = (iso: string) => new Date(iso);
const EURUSD = {
  symbol: "EURUSD",
  pipSize: "0.0001",
  contractSize: "100000",
  digits: 5,
  quoteCurrency: "USD",
  assetClass: "FX" as const,
};

describe("aggregateFills", () => {
  it("one entry and one exit reproduce the single-row trade exactly", () => {
    const legacy: TradeInput = {
      instrument: EURUSD,
      direction: "LONG",
      entryPrice: "1.10000",
      exitPrice: "1.10200",
      stopLoss: "1.09900",
      volumeLots: "1",
      commission: "7",
      openedAt: t("2026-03-04T13:30:00Z"),
      closedAt: t("2026-03-04T15:00:00Z"),
    };
    const agg = aggregateFills(simpleFills({ ...legacy, closedAt: legacy.closedAt }));
    const fromFills: TradeInput = {
      ...legacy,
      entryPrice: agg.entryPrice,
      exitPrice: agg.exitPrice!,
      volumeLots: agg.volumeLots,
      openedAt: agg.openedAt,
      closedAt: agg.closedAt!,
    };
    const a = computeTrade(legacy);
    const b = computeTrade(fromFills);
    expect(b.netPnl!.toString()).toBe(a.netPnl!.toString());
    expect(b.rMultiple!.toString()).toBe(a.rMultiple!.toString());
    expect(b.pips!.toString()).toBe(a.pips!.toString());
    expect(b.holdingMinutes).toBe(a.holdingMinutes);
  });

  it("scaling in and partial closes: VWAP prices, total volume, first open, last close", () => {
    const fills: Fill[] = [
      { kind: "ENTRY", executedAt: t("2026-03-04T10:00:00Z"), price: "1.1000", volumeLots: "1" },
      { kind: "EXIT", executedAt: t("2026-03-04T11:00:00Z"), price: "1.1030", volumeLots: "0.5" },
      { kind: "ENTRY", executedAt: t("2026-03-04T12:00:00Z"), price: "1.1020", volumeLots: "1" },
      { kind: "EXIT", executedAt: t("2026-03-04T14:00:00Z"), price: "1.1050", volumeLots: "1.5" },
    ];
    const agg = aggregateFills(fills);
    expect(agg.entryPrice.toString()).toBe("1.101");
    expect(agg.exitPrice!.toString()).toBe("1.1045");
    expect(agg.volumeLots.toString()).toBe("2");
    expect(agg.status).toBe("CLOSED");
    expect(agg.openedAt.toISOString()).toBe("2026-03-04T10:00:00.000Z");
    expect(agg.closedAt!.toISOString()).toBe("2026-03-04T14:00:00.000Z");

    // The aggregate's gross equals the cash actually realised, fill by fill:
    // exits 0.5×1.1030 + 1.5×1.1050, entries 1×1.1000 + 1×1.1020.
    const realised = new Decimal("0.5")
      .times("1.1030")
      .plus(new Decimal("1.5").times("1.1050"))
      .minus(new Decimal("1.1000").plus("1.1020"))
      .times(100000);
    const gross = agg.exitPrice!.minus(agg.entryPrice).times(agg.volumeLots).times(100000);
    expect(gross.toString()).toBe(realised.toString());
  });

  it("a partially closed position stays OPEN with no exit price", () => {
    const agg = aggregateFills([
      { kind: "ENTRY", executedAt: t("2026-03-04T10:00:00Z"), price: "1.1", volumeLots: "2" },
      { kind: "EXIT", executedAt: t("2026-03-04T11:00:00Z"), price: "1.2", volumeLots: "0.5" },
    ]);
    expect(agg).toMatchObject({ status: "OPEN", exitPrice: null, closedAt: null });
    expect(agg.exitedLots.toString()).toBe("0.5");
  });

  it("orders an entry before an exit stamped at the same instant", () => {
    const same = t("2026-03-04T10:00:00Z");
    expect(
      validateFills([
        { kind: "EXIT", executedAt: same, price: "1.2", volumeLots: "1" },
        { kind: "ENTRY", executedAt: same, price: "1.1", volumeLots: "1" },
      ]),
    ).toEqual([]);
  });
});

describe("validateFills", () => {
  const entry: Fill = { kind: "ENTRY", executedAt: t("2026-03-04T10:00:00Z"), price: "1.1", volumeLots: "1" };
  it.each<[string, Fill[], string]>([
    ["no entry", [{ ...entry, kind: "EXIT" }], "NO_ENTRY"],
    [
      "exit before entry",
      [entry, { ...entry, kind: "EXIT", executedAt: t("2026-03-04T09:00:00Z") }],
      "EXIT_BEFORE_ENTRY",
    ],
    [
      "over-closed",
      [entry, { ...entry, kind: "EXIT", executedAt: t("2026-03-04T11:00:00Z"), volumeLots: "1.5" }],
      "OVER_CLOSED",
    ],
    ["zero volume", [{ ...entry, volumeLots: "0" }], "NON_POSITIVE"],
  ])("%s", (_, fills, code) => {
    expect(validateFills(fills).map((p) => p.code)).toContain(code);
  });
});
