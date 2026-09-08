import { Decimal as PrismaDecimal } from "@prisma/client/runtime/library";
import type { Instrument, Trade } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { derivedColumns, instrumentSpec, realisedPnl, toTradeRow, tradeConversion, tradeInput } from "./trade-service";

/**
 * The Decimal-to-plain bridge for every trade write, and the one place that
 * decides which conversion rate a trade's P&L was computed at. Untested
 * before, which is uncomfortable for code that owns the stored `netPnl`,
 * `pips` and `rMultiple` columns.
 */

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    symbol: "EURUSD",
    displayName: "Euro / US Dollar",
    pipSize: new PrismaDecimal("0.0001"),
    contractSize: new PrismaDecimal("100000"),
    digits: 5,
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    assetClass: "FX",
    isActive: true,
    ...overrides,
  } as Instrument;
}

type TradeFields = Parameters<typeof tradeInput>[0];

function trade(overrides: Partial<Record<keyof TradeFields, unknown>> = {}): TradeFields {
  return {
    direction: "LONG",
    entryPrice: new PrismaDecimal("1.10000"),
    exitPrice: new PrismaDecimal("1.10500"),
    stopLoss: new PrismaDecimal("1.09500"),
    takeProfit: new PrismaDecimal("1.11500"),
    volumeLots: new PrismaDecimal("1"),
    commission: new PrismaDecimal("3.50"),
    swap: new PrismaDecimal("0"),
    conversionRate: null,
    openedAt: new Date("2026-09-08T08:00:00.000Z"),
    closedAt: new Date("2026-09-08T10:30:00.000Z"),
    ...overrides,
  } as TradeFields;
}

describe("instrumentSpec", () => {
  it("stringifies the Decimal columns, keeping precision", () => {
    // The metrics layer takes strings so nothing crosses through a float.
    const spec = instrumentSpec(instrument());
    expect(spec.pipSize).toBe("0.0001");
    expect(spec.contractSize).toBe("100000");
    expect(typeof spec.pipSize).toBe("string");
  });

  it("passes through the non-numeric fields", () => {
    const spec = instrumentSpec(instrument({ symbol: "USDJPY", quoteCurrency: "JPY", digits: 3 }));
    expect(spec).toMatchObject({ symbol: "USDJPY", quoteCurrency: "JPY", digits: 3, assetClass: "FX" });
  });
});

describe("tradeInput", () => {
  it("stringifies every numeric field", () => {
    const input = tradeInput(trade(), instrument(), "USD");
    expect(input.entryPrice).toBe("1.1");
    expect(input.volumeLots).toBe("1");
    expect(input.commission).toBe("3.5");
  });

  it("leaves absent optional fields undefined, not zero", () => {
    const input = tradeInput(
      trade({ exitPrice: null, stopLoss: null, takeProfit: null, closedAt: null }),
      instrument(),
      "USD",
    );
    expect(input.exitPrice).toBeUndefined();
    expect(input.stopLoss).toBeUndefined();
    expect(input.takeProfit).toBeUndefined();
    expect(input.closedAt).toBeUndefined();
  });

  describe("conversion rate", () => {
    it("resolves to 1 when the quote currency is the account currency", () => {
      const input = tradeInput(trade(), instrument(), "USD");
      expect(input.conversionRate).toBe("1");
    });

    it("uses the EXIT price as the reference, not the entry", () => {
      // The exit is the rate that actually realised the P&L. Using the entry
      // would price the result at the rate when the trade opened.
      const input = tradeInput(
        trade({ entryPrice: new PrismaDecimal("150.00"), exitPrice: new PrismaDecimal("160.00") }),
        instrument({ symbol: "USDJPY", baseCurrency: "USD", quoteCurrency: "JPY" }),
        "USD",
      );
      expect(input.conversionRate).toBe("0.00625"); // 1/160, not 1/150
    });

    it("falls back to the entry price while the trade is still open", () => {
      const input = tradeInput(
        trade({ entryPrice: new PrismaDecimal("150.00"), exitPrice: null, closedAt: null }),
        instrument({ symbol: "USDJPY", baseCurrency: "USD", quoteCurrency: "JPY" }),
        "USD",
      );
      expect(input.conversionRate).toBe("0.0066666666666666666667");
    });

    it("prefers the trade's own stored rate over anything derived", () => {
      const input = tradeInput(
        trade({ conversionRate: new PrismaDecimal("0.0068") }),
        instrument({ symbol: "USDJPY", baseCurrency: "USD", quoteCurrency: "JPY" }),
        "USD",
      );
      expect(input.conversionRate).toBe("0.0068");
    });

    it("passes through the stored rate untouched when no account currency is known", () => {
      // The documented case: a preview computed before an account is chosen.
      const input = tradeInput(trade({ conversionRate: new PrismaDecimal("0.0068") }), instrument());
      expect(input.conversionRate).toBe("0.0068");
    });

    it("leaves the rate undefined when neither is available", () => {
      expect(tradeInput(trade(), instrument()).conversionRate).toBeUndefined();
    });
  });
});

describe("tradeConversion", () => {
  it("reports the decision and whether it needs attention", () => {
    const identity = tradeConversion(trade(), instrument(), "USD");
    expect(identity.source).toBe("IDENTITY");
    expect(identity.needsAttention).toBe(false);
  });

  it("flags a cross pair whose rate cannot be derived", () => {
    // EURJPY in a USD account: neither leg is the account currency.
    const flagged = tradeConversion(
      trade(),
      instrument({ symbol: "EURJPY", baseCurrency: "EUR", quoteCurrency: "JPY" }),
      "USD",
    );
    expect(flagged.source).toBe("ASSUMED_ONE");
    expect(flagged.needsAttention).toBe(true);
  });
});

describe("derivedColumns", () => {
  it("returns strings for the Decimal columns and a number for the minutes", () => {
    const derived = derivedColumns(tradeInput(trade(), instrument(), "USD"));
    expect(typeof derived.grossPnl).toBe("string");
    expect(typeof derived.netPnl).toBe("string");
    expect(typeof derived.holdingMinutes).toBe("number");
  });

  it("computes a winning long trade", () => {
    // 50 pips on a 1-lot EURUSD is $500 gross, less $3.50 commission.
    const derived = derivedColumns(tradeInput(trade(), instrument(), "USD"));
    expect(derived.grossPnl).toBe("500");
    expect(derived.netPnl).toBe("496.5");
    expect(derived.pips).toBe("50");
  });

  it("computes holding time in minutes", () => {
    expect(derivedColumns(tradeInput(trade(), instrument(), "USD")).holdingMinutes).toBe(150);
  });

  it("derives an R multiple from the stop distance", () => {
    // Risk is 50 pips ($500); reward realised is 50 pips, so R is ~1 net of
    // costs rather than exactly 1.
    const derived = derivedColumns(tradeInput(trade(), instrument(), "USD"));
    expect(derived.riskAmount).toBe("500");
    expect(Number(derived.rMultiple)).toBeCloseTo(0.993, 3);
  });

  it("leaves the R multiple null when there was no stop loss", () => {
    // Same contract as summarize()'s expectancyR: no stop means no R, and
    // reporting 0 would assert something the data cannot support.
    const derived = derivedColumns(tradeInput(trade({ stopLoss: null }), instrument(), "USD"));
    expect(derived.rMultiple).toBeNull();
    expect(derived.riskAmount).toBeNull();
  });

  it("leaves P&L null for an open trade", () => {
    const derived = derivedColumns(tradeInput(trade({ exitPrice: null, closedAt: null }), instrument(), "USD"));
    expect(derived.netPnl).toBeNull();
    expect(derived.holdingMinutes).toBeNull();
  });

  it("applies the conversion rate to a JPY-quoted trade", () => {
    // The case conversion.ts's header warns about: at 1:1 this would report a
    // ~$100,000 result on a trade that made about $625.
    const derived = derivedColumns(
      tradeInput(
        trade({
          entryPrice: new PrismaDecimal("150.000"),
          exitPrice: new PrismaDecimal("151.000"),
          stopLoss: null,
          takeProfit: null,
          commission: new PrismaDecimal("0"),
        }),
        instrument({
          symbol: "USDJPY",
          baseCurrency: "USD",
          quoteCurrency: "JPY",
          pipSize: new PrismaDecimal("0.01"),
          digits: 3,
        }),
        "USD",
      ),
    );
    expect(Number(derived.grossPnl)).toBeCloseTo(662.25, 2);
  });

  it("records the market session from the open time", () => {
    expect(derivedColumns(tradeInput(trade(), instrument(), "USD")).marketSession).toBeTruthy();
  });
});

describe("toTradeRow", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return toTradeRow({
      netPnl: new PrismaDecimal("100"),
      rMultiple: new PrismaDecimal("2"),
      openedAt: new Date("2026-09-08T08:00:00.000Z"),
      closedAt: new Date("2026-09-08T10:00:00.000Z"),
      holdingMinutes: 120,
      status: "CLOSED",
      ...overrides,
    } as Pick<Trade, "netPnl" | "rMultiple" | "openedAt" | "closedAt" | "holdingMinutes" | "status">);
  }

  it("uses the STORED columns rather than recomputing", () => {
    // Deliberate, per the function's doc: a report must never disagree with
    // the number shown on the trade itself.
    expect(row({ netPnl: new PrismaDecimal("999") }).netPnl?.toString()).toBe("999");
  });

  describe("outcome classification", () => {
    it("is WIN above the breakeven band", () => {
      expect(row({ netPnl: new PrismaDecimal("0.01") }).outcome).toBe("WIN");
    });

    it("is LOSS below it", () => {
      expect(row({ netPnl: new PrismaDecimal("-0.01") }).outcome).toBe("LOSS");
    });

    it("is BREAKEVEN inside it", () => {
      // The epsilon is 0.005, so half a cent either way is a breakeven.
      for (const value of ["0", "0.004", "-0.004"]) {
        expect(row({ netPnl: new PrismaDecimal(value) }).outcome, value).toBe("BREAKEVEN");
      }
    });

    it("treats the epsilon as exclusive at the boundary", () => {
      expect(row({ netPnl: new PrismaDecimal("0.005") }).outcome).toBe("WIN");
      expect(row({ netPnl: new PrismaDecimal("-0.005") }).outcome).toBe("LOSS");
    });

    it("is OPEN for any non-closed status, whatever the P&L says", () => {
      for (const status of ["OPEN", "CANCELLED"] as const) {
        expect(row({ status }).outcome, status).toBe("OPEN");
      }
    });

    it("is OPEN when the P&L is null even on a closed trade", () => {
      expect(row({ netPnl: null }).outcome).toBe("OPEN");
    });
  });
});

describe("realisedPnl", () => {
  it("sums net P&L", () => {
    const total = realisedPnl([
      { netPnl: new PrismaDecimal("100.50") },
      { netPnl: new PrismaDecimal("-40.25") },
      { netPnl: new PrismaDecimal("10") },
    ]);
    expect(total.toString()).toBe("70.25");
  });

  it("treats a null as zero rather than poisoning the sum", () => {
    const total = realisedPnl([{ netPnl: new PrismaDecimal("100") }, { netPnl: null }]);
    expect(total.toString()).toBe("100");
  });

  it("is zero for an empty list", () => {
    expect(realisedPnl([]).toString()).toBe("0");
  });

  it("sums without float drift", () => {
    // Ten additions of 0.1 is exactly 1 in Decimal, and 0.9999999999999999 in
    // floating point. This is the reason the whole layer uses Decimal.
    const trades = Array.from({ length: 10 }, () => ({ netPnl: new PrismaDecimal("0.1") }));
    expect(realisedPnl(trades).toString()).toBe("1");
  });
});
