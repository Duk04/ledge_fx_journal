import { describe, expect, it } from "vitest";
import { filterOptions, instrumentOptions } from "./combobox";

const options = instrumentOptions([
  { symbol: "EURUSD", displayName: "Euro / US Dollar" },
  { symbol: "GBPUSD", displayName: "British Pound / US Dollar" },
  { symbol: "XAUUSD", displayName: "Gold / US Dollar" },
]);

describe("filterOptions", () => {
  it("returns everything for an empty query", () => {
    expect(filterOptions(options, "  ")).toHaveLength(3);
  });

  it("matches a pair however it is spelled", () => {
    for (const q of ["eurusd", "EUR/USD", "eur usd", "euro"]) {
      expect(filterOptions(options, q).map((o) => o.value)).toEqual(["EURUSD"]);
    }
  });

  it("matches the display name", () => {
    expect(filterOptions(options, "gold").map((o) => o.value)).toEqual(["XAUUSD"]);
  });

  it("maps plain symbol lists", () => {
    expect(instrumentOptions(["US30"])).toEqual([{ value: "US30", label: "US30" }]);
  });
});
