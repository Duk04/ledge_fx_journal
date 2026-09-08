import { describe, expect, it } from "vitest";
import { closeTradeSchema, parseTradeForm } from "./trade";

/**
 * `parseTradeForm` is the gate every trade write passes through — both
 * `createTrade` and `updateTrade` call it, and it is the authoritative check
 * (the client form runs the same schema through `zodResolver`, but a client
 * check is a courtesy).
 *
 * Two things it must get right beyond "is this a number", and both are easy
 * to break:
 *
 *  - Empty string means "left blank", not zero. A commission of "" that
 *    parsed as 0 would be indistinguishable from a genuinely free trade, and
 *    the difference shows up in every net-P&L figure.
 *  - Geometry problems are WARNINGS, never errors. Traders back-fill broker
 *    statements and record trades where the stop moved mid-trade; refusing
 *    those rows would make the journal useless for exactly the trades most
 *    worth reviewing.
 */

/** Builds FormData the way the trade form posts it: everything a string. */
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
    else fd.set(key, value);
  }
  return fd;
}

/** The minimum an OPEN trade needs. */
const OPEN_TRADE = {
  symbol: "EURUSD",
  direction: "LONG",
  status: "OPEN",
  openedAt: "2026-09-08T10:00",
  entryPrice: "1.1000",
  volumeLots: "1",
};

/** A complete CLOSED trade. */
const CLOSED_TRADE = {
  ...OPEN_TRADE,
  status: "CLOSED",
  closedAt: "2026-09-08T12:00",
  exitPrice: "1.1050",
};

describe("parseTradeForm", () => {
  describe("the happy paths", () => {
    it("accepts a minimal open trade", () => {
      const result = parseTradeForm(form(OPEN_TRADE));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.values.symbol).toBe("EURUSD");
      expect(result.values.entryPrice).toBe(1.1);
      expect(result.values.volumeLots).toBe(1);
      expect(result.values.tagIds).toEqual([]);
    });

    it("accepts a complete closed trade", () => {
      const result = parseTradeForm(form(CLOSED_TRADE));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.values.exitPrice).toBe(1.105);
      expect(result.values.closedAt).toBeInstanceOf(Date);
    });

    it("uppercases and trims the symbol", () => {
      const result = parseTradeForm(form({ ...OPEN_TRADE, symbol: "  eurusd  " }));
      expect(result.ok && result.values.symbol).toBe("EURUSD");
    });

    it("collects every posted tagId, not just the first", () => {
      // `.get()` would silently truncate a multi-valued field to one entry,
      // which is why parseTradeForm uses `.getAll()` for this one key.
      const result = parseTradeForm(form({ ...OPEN_TRADE, tagIds: ["tag-a", "tag-b", "tag-c"] }));
      expect(result.ok && result.values.tagIds).toEqual(["tag-a", "tag-b", "tag-c"]);
    });

    it("drops empty tagIds rather than failing on them", () => {
      // An unchecked checkbox group can post an empty value.
      const result = parseTradeForm(form({ ...OPEN_TRADE, tagIds: ["tag-a", "", "tag-b"] }));
      expect(result.ok && result.values.tagIds).toEqual(["tag-a", "tag-b"]);
    });
  });

  describe("required fields", () => {
    it.each(["symbol", "direction", "status", "openedAt", "entryPrice", "volumeLots"])(
      "rejects a missing %s",
      (key) => {
        const fields: Record<string, string> = { ...OPEN_TRADE };
        delete fields[key];
        const result = parseTradeForm(form(fields));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(Object.keys(result.fieldErrors)).toContain(key);
      },
    );

    it("rejects an empty required field as firmly as a missing one", () => {
      const result = parseTradeForm(form({ ...OPEN_TRADE, entryPrice: "" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.entryPrice).toBeDefined();
    });

    it("reports every problem at once, so the form can mark all the fields", () => {
      const result = parseTradeForm(form({ symbol: "EURUSD", direction: "LONG", status: "OPEN" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(Object.keys(result.fieldErrors).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("empty string means blank, not zero", () => {
    it.each(["exitPrice", "stopLoss", "takeProfit", "commission", "swap", "conversionRate"])(
      "leaves %s undefined when posted empty",
      (key) => {
        const result = parseTradeForm(form({ ...OPEN_TRADE, [key]: "" }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.values[key as "exitPrice"]).toBeUndefined();
      },
    );

    it("keeps a genuine zero commission as 0, not undefined", () => {
      // The distinction the whole preprocess exists for.
      const result = parseTradeForm(form({ ...OPEN_TRADE, commission: "0" }));
      expect(result.ok && result.values.commission).toBe(0);
    });

    it("leaves optional enums undefined when blank", () => {
      const result = parseTradeForm(form({ ...OPEN_TRADE, emotion: "", confidence: "", notes: "" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.values.emotion).toBeUndefined();
      expect(result.values.confidence).toBeUndefined();
      expect(result.values.notes).toBeUndefined();
    });
  });

  describe("broker costs may be negative", () => {
    it("accepts a negative commission, which is a rebate", () => {
      const result = parseTradeForm(form({ ...OPEN_TRADE, commission: "-2.50" }));
      expect(result.ok && result.values.commission).toBe(-2.5);
    });

    it("accepts a negative swap, which is a credit", () => {
      const result = parseTradeForm(form({ ...OPEN_TRADE, swap: "-1.25" }));
      expect(result.ok && result.values.swap).toBe(-1.25);
    });

    it("still rejects a negative price, volume or conversion rate", () => {
      for (const key of ["entryPrice", "volumeLots", "conversionRate", "stopLoss", "takeProfit"]) {
        const result = parseTradeForm(form({ ...OPEN_TRADE, [key]: "-1" }));
        expect(result.ok, key).toBe(false);
      }
    });

    it("rejects a zero price or volume", () => {
      for (const key of ["entryPrice", "volumeLots"]) {
        const result = parseTradeForm(form({ ...OPEN_TRADE, [key]: "0" }));
        expect(result.ok, key).toBe(false);
      }
    });

    it("rejects a non-finite number", () => {
      for (const value of ["Infinity", "-Infinity", "NaN", "abc"]) {
        const result = parseTradeForm(form({ ...OPEN_TRADE, entryPrice: value }));
        expect(result.ok, value).toBe(false);
      }
    });
  });

  describe("CLOSED requires the two closing fields", () => {
    it("rejects a closed trade with no exit price", () => {
      const fields = { ...CLOSED_TRADE };
      delete (fields as Record<string, string>).exitPrice;
      const result = parseTradeForm(form(fields));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.exitPrice?.[0]).toMatch(/required to close/i);
    });

    it("rejects a closed trade with no close time", () => {
      const fields = { ...CLOSED_TRADE };
      delete (fields as Record<string, string>).closedAt;
      const result = parseTradeForm(form(fields));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.closedAt?.[0]).toMatch(/required to close/i);
    });

    it("does not require them for an OPEN trade", () => {
      expect(parseTradeForm(form(OPEN_TRADE)).ok).toBe(true);
    });

    it("does not require them for a CANCELLED trade", () => {
      // A cancelled order never filled, so it has no exit.
      expect(parseTradeForm(form({ ...OPEN_TRADE, status: "CANCELLED" })).ok).toBe(true);
    });
  });

  describe("symbol existence", () => {
    it("rejects a symbol outside the allowed list", () => {
      const result = parseTradeForm(form({ ...OPEN_TRADE, symbol: "FAKEPAIR" }), {
        validSymbols: ["EURUSD", "GBPUSD"],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fieldErrors.symbol?.[0]).toMatch(/unknown symbol/i);
    });

    it("accepts one inside it", () => {
      const result = parseTradeForm(form(OPEN_TRADE), { validSymbols: ["EURUSD", "GBPUSD"] });
      expect(result.ok).toBe(true);
    });

    it("matches case-insensitively, since the symbol is uppercased first", () => {
      const result = parseTradeForm(form({ ...OPEN_TRADE, symbol: "eurusd" }), { validSymbols: ["eurusd"] });
      expect(result.ok).toBe(true);
    });

    it("skips the check entirely when no list is supplied", () => {
      // The client form has its own list; a caller with none should not have
      // every symbol rejected.
      expect(parseTradeForm(form({ ...OPEN_TRADE, symbol: "ANYTHING" })).ok).toBe(true);
    });
  });

  describe("followedPlan is tri-state", () => {
    it.each([
      ["yes", true],
      ["no", false],
    ])("reads %s as %s", (raw, expected) => {
      const result = parseTradeForm(form({ ...OPEN_TRADE, followedPlan: raw }));
      expect(result.ok && result.values.followedPlan).toBe(expected);
    });

    it("reads an untouched control as undefined, which is a real answer", () => {
      // "Unknown" is distinct from "no" for a trade logged after the fact.
      const result = parseTradeForm(form({ ...OPEN_TRADE, followedPlan: "" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.values.followedPlan).toBeUndefined();
    });

    it("reads an absent field as undefined too", () => {
      const result = parseTradeForm(form(OPEN_TRADE));
      expect(result.ok && result.values.followedPlan).toBeUndefined();
    });
  });

  describe("bounded fields", () => {
    it("accepts emotion and confidence in 1..5", () => {
      for (const value of ["1", "3", "5"]) {
        expect(parseTradeForm(form({ ...OPEN_TRADE, emotion: value })).ok, value).toBe(true);
      }
    });

    it("rejects them outside 1..5", () => {
      for (const value of ["0", "6", "-1"]) {
        expect(parseTradeForm(form({ ...OPEN_TRADE, emotion: value })).ok, value).toBe(false);
      }
    });

    it("rejects a fractional rating", () => {
      expect(parseTradeForm(form({ ...OPEN_TRADE, confidence: "3.5" })).ok).toBe(false);
    });

    it("caps notes at 4000 characters", () => {
      expect(parseTradeForm(form({ ...OPEN_TRADE, notes: "x".repeat(4000) })).ok).toBe(true);
      expect(parseTradeForm(form({ ...OPEN_TRADE, notes: "x".repeat(4001) })).ok).toBe(false);
    });

    it("rejects a tag id with unsafe characters", () => {
      for (const id of ["../etc", "tag id", "tag/id", "x".repeat(65)]) {
        expect(parseTradeForm(form({ ...OPEN_TRADE, tagIds: [id] })).ok, id).toBe(false);
      }
    });

    it("accepts the slug-style ids this app’s own seed data uses", () => {
      // prisma/seed.ts uses fixed slugs like "seed-tag-ob-retest" for
      // reproducibility, so a strict uuid/cuid pattern would reject real rows.
      expect(parseTradeForm(form({ ...OPEN_TRADE, tagIds: ["seed-tag-ob-retest"] })).ok).toBe(true);
    });
  });

  describe("geometry problems are warnings, never errors", () => {
    it("accepts a long trade whose stop is above entry, and warns", () => {
      const result = parseTradeForm(
        form({ ...CLOSED_TRADE, direction: "LONG", entryPrice: "1.1000", stopLoss: "1.2000" }),
      );
      // The row saves. This is a trader back-filling a statement, not a
      // validation failure.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("accepts a closed trade whose close precedes its open, and warns", () => {
      const result = parseTradeForm(
        form({ ...CLOSED_TRADE, openedAt: "2026-09-08T12:00", closedAt: "2026-09-08T10:00" }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("reports no warnings for a clean trade", () => {
      const result = parseTradeForm(
        form({ ...CLOSED_TRADE, direction: "LONG", stopLoss: "1.0950", takeProfit: "1.1100" }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
    });
  });
});

describe("closeTradeSchema", () => {
  it("accepts a price and a time", () => {
    const result = closeTradeSchema.safeParse({ exitPrice: "1.1050", closedAt: "2026-09-08T12:00" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.exitPrice).toBe(1.105);
    expect(result.data.closedAt).toBeInstanceOf(Date);
  });

  it("requires both", () => {
    expect(closeTradeSchema.safeParse({ exitPrice: "1.1" }).success).toBe(false);
    expect(closeTradeSchema.safeParse({ closedAt: "2026-09-08T12:00" }).success).toBe(false);
  });

  it("rejects a zero, negative or non-finite exit price", () => {
    for (const exitPrice of ["0", "-1", "Infinity", "abc"]) {
      const result = closeTradeSchema.safeParse({ exitPrice, closedAt: "2026-09-08T12:00" });
      expect(result.success, exitPrice).toBe(false);
    }
  });

  it("rejects an unparseable date", () => {
    expect(closeTradeSchema.safeParse({ exitPrice: "1.1", closedAt: "not a date" }).success).toBe(false);
  });
});
