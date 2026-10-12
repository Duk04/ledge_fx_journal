import { describe, expect, it } from "vitest";
import { MT4_DETAILED, MT5_REPORT, utf16le } from "./fixtures";
import { brokerTimeToUtc, decodeStatement, detectFormat, parseStatement, reconcile, resolveSymbol } from "./index";
import { seedInstruments } from "@/lib/instruments";

const NY = { mode: "ny-close" } as const;
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const KNOWN = new Set(seedInstruments.map((i) => i.symbol));
const spec = (symbol: string) => {
  const i = seedInstruments.find((s) => s.symbol === symbol)!;
  return { symbol, baseCurrency: i.baseCurrency, quoteCurrency: i.quoteCurrency, contractSize: i.contractSize };
};

describe("brokerTimeToUtc", () => {
  it("ny-close is UTC+2 before the US DST switch and UTC+3 after it", () => {
    // US DST 2026 starts Sunday 8 March.
    expect(iso(brokerTimeToUtc("2026.03.06 12:00:00", NY))).toBe("2026-03-06T10:00:00.000Z");
    expect(iso(brokerTimeToUtc("2026.03.09 12:00:00", NY))).toBe("2026-03-09T09:00:00.000Z");
    expect(iso(brokerTimeToUtc("2026.07.14 10:00", NY))).toBe("2026-07-14T07:00:00.000Z");
  });

  it("rolls the date back across midnight", () => {
    expect(iso(brokerTimeToUtc("2026.01.05 01:00:00", NY))).toBe("2026-01-04T23:00:00.000Z");
  });

  it("applies a fixed offset as given", () => {
    expect(iso(brokerTimeToUtc("2026.03.09 12:00:00", { mode: "fixed", offsetMinutes: 120 }))).toBe(
      "2026-03-09T10:00:00.000Z",
    );
  });

  it("leaves an ISO timestamp with its own offset alone", () => {
    expect(iso(brokerTimeToUtc("2026-03-09T12:00:00Z", { mode: "fixed", offsetMinutes: 180 }))).toBe(
      "2026-03-09T12:00:00.000Z",
    );
  });

  it("returns null for garbage", () => {
    expect(brokerTimeToUtc("yesterday", NY)).toBeNull();
    expect(brokerTimeToUtc("2026.13.01 00:00", NY)).toBeNull();
  });
});

describe("MT4 detailed statement", () => {
  const r = parseStatement(MT4_DETAILED, NY);

  it("is detected and reads the account currency", () => {
    expect(detectFormat(MT4_DETAILED)).toBe("MT4_HTML");
    expect(r.source).toBe("MT4_HTML");
    expect(r.currency).toBe("USD");
  });

  it("reads closed and open positions, skipping cancelled pending orders with a warning", () => {
    expect(r.positions.map((p) => p.ticket)).toEqual(["50000002", "50000003", "50000005"]);
    expect(r.warnings.join(" ")).toMatch(/1 cancelled pending order/);
    expect(r.skipped).toBe(0);
  });

  it("converts a closed buy faithfully, flipping cost signs to the journal's", () => {
    const p = r.positions[0];
    expect(p).toMatchObject({
      symbolRaw: "eurusd",
      direction: "LONG",
      entryPrice: "1.10000",
      exitPrice: "1.10200",
      volumeLots: "1.00",
      stopLoss: "1.09900",
      takeProfit: null, // 0.00000 means "not set"
      commission: "7.5", // -7.00 commission + -0.50 taxes, as a positive cost
      swap: "1.2",
      brokerProfit: "200.00",
    });
    expect(iso(p.openedAt)).toBe("2026-03-04T13:30:00.000Z");
    expect(iso(p.closedAt)).toBe("2026-03-04T15:00:00.000Z");
    expect(p.fills).toHaveLength(2);
  });

  it("gives an open trade no exit, even though the row has a current price", () => {
    const open = r.positions[2];
    expect(open).toMatchObject({ direction: "SHORT", closedAt: null, exitPrice: null, brokerProfit: null });
    expect(iso(open.openedAt)).toBe("2026-03-10T08:00:00.000Z"); // after DST: UTC+3
    expect(open.fills).toHaveLength(1);
  });

  it("reads a deposit with a thousands separator", () => {
    expect(r.balanceEvents).toEqual([
      expect.objectContaining({ ticket: "50000001", amount: "10000.00", comment: "Deposit" }),
    ]);
  });
});

describe("MT5 report", () => {
  it("decodes UTF-16LE (how MT5 writes it) before detecting the format", () => {
    const text = decodeStatement(utf16le(MT5_REPORT));
    expect(text).toBe(MT5_REPORT);
    expect(detectFormat(text)).toBe("MT5_HTML");
  });

  const r = parseStatement(MT5_REPORT, NY);

  it("uses the position id as the ticket and the paired Time/Price columns as open/close", () => {
    expect(r.positions.map((p) => p.ticket)).toEqual(["9000001", "9000002", "9000003"]);
    const usdjpy = r.positions[0];
    expect(usdjpy).toMatchObject({
      direction: "SHORT",
      entryPrice: "148.500",
      exitPrice: "148.000",
      stopLoss: "149.000",
      takeProfit: null,
      commission: "6",
      swap: "2.1",
      brokerProfit: "337.84",
    });
    expect(iso(usdjpy.openedAt)).toBe("2026-07-14T07:00:00.000Z");
    expect(iso(usdjpy.closedAt)).toBe("2026-07-14T15:30:15.000Z");
  });

  it("reads space-grouped prices and profits", () => {
    expect(r.positions[1]).toMatchObject({ entryPrice: "19500.0", exitPrice: "19560.0", brokerProfit: "3000.00" });
  });

  it("reads open positions without an exit", () => {
    expect(r.positions[2]).toMatchObject({ symbolRaw: "EURUSD", closedAt: null, exitPrice: null });
  });

  it("takes deposits and withdrawals from the Deals balance rows", () => {
    expect(r.balanceEvents.map((e) => [e.ticket, e.amount])).toEqual([
      ["8000001", "25000.00"],
      ["8000099", "-1000.00"],
    ]);
    expect(r.currency).toBe("USD");
  });
});

describe("generic CSV", () => {
  it("maps aliased headers in any order, with ; separators and ISO times", () => {
    const csv = [
      "Position;Instrument;Side;Lots;Entry Time;Entry Price;Exit Time;Exit Price;Commission;Swap;PnL",
      "A-1;GBPUSD;Sell;0.30;2026-03-04T13:30:00Z;1.27000;2026-03-04T14:00:00Z;1.26800;-2.10;0;60.00",
      "A-2;GBPUSD;Buy;0.30;2026-03-05 10:00:00;1.26000;;;;;",
      "bad;GBPUSD;Hold;0.30;2026-03-05 10:00:00;1.26000;;;;;",
    ].join("\n");
    const r = parseStatement(csv, NY);
    expect(r.source).toBe("CSV");
    expect(r.skipped).toBe(1);
    expect(r.positions[0]).toMatchObject({
      ticket: "A-1",
      direction: "SHORT",
      commission: "2.1",
      brokerProfit: "60.00",
    });
    expect(iso(r.positions[0].openedAt)).toBe("2026-03-04T13:30:00.000Z");
    expect(r.positions[1]).toMatchObject({ ticket: "A-2", closedAt: null });
    expect(iso(r.positions[1].openedAt)).toBe("2026-03-05T08:00:00.000Z");
  });

  it("names the missing required columns", () => {
    const r = parseStatement("Symbol,Type\nEURUSD,buy", NY);
    expect(r.positions).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/ticket, volume, openTime, openPrice/);
  });
});

describe("parseStatement on an unrecognised HTML file", () => {
  it("explains what to export instead of returning nothing", () => {
    const r = parseStatement("<html><table><tr><td>hello</td></tr></table></html>", NY);
    expect(r.warnings[0]).toMatch(/doesn't look like a MetaTrader statement/);
  });
});

describe("resolveSymbol", () => {
  it.each([
    ["eurusd", "EURUSD"],
    ["EURUSD.m", "EURUSD"],
    ["#EURUSD", "EURUSD"],
    ["EURJPYm", "EURJPY"],
    ["XAUUSD-ECN", "XAUUSD"],
    ["GOLD", "XAUUSD"],
    ["GOLDmicro", null],
    ["US100.cash", "NAS100"],
    ["FOOBAR", null],
  ])("%s -> %s", (raw, expected) => {
    expect(resolveSymbol(raw, KNOWN)).toBe(expected);
  });

  it("prefers the user's saved alias over every heuristic", () => {
    expect(resolveSymbol("GOLD", KNOWN, new Map([["GOLD", "XAGUSD"]]))).toBe("XAGUSD");
  });
});

describe("reconcile", () => {
  const mt4 = parseStatement(MT4_DETAILED, NY).positions;
  const mt5 = parseStatement(MT5_REPORT, NY).positions;

  it("quote = account: no rate stored, and our gross agrees with the broker", () => {
    expect(reconcile(mt4[0], spec("EURUSD"), "USD")).toMatchObject({
      conversionRate: null,
      source: "IDENTITY",
      grossPnl: "200",
      mismatch: false,
    });
  });

  it("account = base: the inverse price is the rate, and agrees within tolerance", () => {
    expect(reconcile(mt5[0], spec("USDJPY"), "USD")).toMatchObject({
      conversionRate: null,
      source: "INVERSE_PRICE",
      grossPnl: "337.84",
      mismatch: false,
    });
  });

  it("a cross takes the rate implied by the broker's profit instead of assuming 1", () => {
    const r = reconcile(mt4[1], spec("EURJPY"), "USD");
    expect(r.source).toBe("IMPLIED");
    expect(r.needsAttention).toBe(false);
    // 201.34 USD / (0.600 JPY × 100,000 × 0.5 lots)
    expect(Number(r.conversionRate)).toBeCloseTo(201.34 / 30000, 12);
  });

  it("flags a disagreement instead of hiding it behind an implied rate", () => {
    // NAS100 at contract size 1: 60 points × 0.5 = $30, but the broker paid
    // $3,000 — this broker's contract is 100× ours. That must be visible.
    const r = reconcile(mt5[1], spec("NAS100"), "USD");
    expect(r.conversionRate).toBeNull();
    expect(r.mismatch).toBe(true);
  });
});
