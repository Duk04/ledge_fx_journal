import { describe, expect, it } from "vitest";
import { parseTradeListQuery } from "./trade-list-query";

const UB = "Asia/Ulaanbaatar"; // UTC+8, no DST
const NOW = new Date("2026-03-10T12:00:00Z");

describe("parseTradeListQuery", () => {
  it("reads a custom range as whole days in the user's timezone", () => {
    const { filters } = parseTradeListQuery({ range: "custom", from: "2026-03-05", to: "2026-03-05" }, UB, NOW);
    // Midnight in Ulaanbaatar is 16:00 UTC the day before.
    expect(filters.from?.toISOString()).toBe("2026-03-04T16:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-03-05T15:59:59.999Z");
  });

  it("starts YTD at the user's New Year, not the server's", () => {
    const { filters } = parseTradeListQuery({ range: "ytd" }, UB, NOW);
    expect(filters.from?.toISOString()).toBe("2025-12-31T16:00:00.000Z");
    expect(filters.to).toBeUndefined();
  });

  it("drops values it does not recognise instead of passing them to the database", () => {
    const { filters, filtersActive } = parseTradeListQuery(
      { directions: "LONG,FOO", outcome: "MAYBE", range: "custom", from: "2026-13-01", to: "nope" },
      UB,
      NOW,
    );
    expect(filters.directions).toEqual(["LONG"]);
    expect(filters.outcomes).toBeUndefined();
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
    expect(filtersActive).toBe(true);
  });

  it("treats an unknown range as all time, and nothing set as no filter", () => {
    const res = parseTradeListQuery({ range: "forever" }, UB, NOW);
    expect(res.filters.from).toBeUndefined();
    expect(res.filtersActive).toBe(false);
  });

  it("clamps paging to a known page size and a page of at least 1", () => {
    expect(parseTradeListQuery({ page: "-3", pageSize: "7" }, UB, NOW)).toMatchObject({ page: 1, pageSize: 50 });
    expect(parseTradeListQuery({ page: "2", pageSize: "100" }, UB, NOW)).toMatchObject({ page: 2, pageSize: 100 });
  });
});
