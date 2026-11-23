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

describe("parseTradeListQuery — filters that arrive by link", () => {
  const IMPORT_ID = "3f2c1a9e-5b7d-4c8e-9f10-2a3b4c5d6e7f";

  it("reads one import's trades, and drops an id that is not a uuid", () => {
    expect(parseTradeListQuery({ import: IMPORT_ID }, UB, NOW).filters.importId).toBe(IMPORT_ID);
    // Postgres rejects a non-uuid outright; a mangled link must not 500.
    const bad = parseTradeListQuery({ import: "'; drop table trades" }, UB, NOW);
    expect(bad.filters.importId).toBeUndefined();
    expect(bad.filtersActive).toBe(false);
  });

  it("reads shots=none as 'no screenshot yet' and nothing else as that", () => {
    expect(parseTradeListQuery({ shots: "none" }, UB, NOW).filters.withoutScreenshot).toBe(true);
    expect(parseTradeListQuery({ shots: "some" }, UB, NOW).filters.withoutScreenshot).toBeUndefined();
  });

  it("reads a day as that whole day in the user's timezone", () => {
    const { filters } = parseTradeListQuery({ day: "2026-03-05" }, UB, NOW);
    expect(filters.day?.from.toISOString()).toBe("2026-03-04T16:00:00.000Z");
    expect(filters.day?.to.toISOString()).toBe("2026-03-05T15:59:59.999Z");
    // Plain Dates, like every other window here.
    expect(filters.day?.from.constructor).toBe(Date);
  });

  it("ignores a day that is not a real date", () => {
    expect(parseTradeListQuery({ day: "2026-02-30" }, UB, NOW).filters.day).toBeUndefined();
  });

  it("leaves the opened-at range alone when a day is set", () => {
    // `day` follows the calendar's close-date rule; it is not a from/to.
    const { filters } = parseTradeListQuery({ day: "2026-03-05" }, UB, NOW);
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
  });

  it.each([{ import: IMPORT_ID }, { shots: "none" }, { day: "2026-03-05" }])(
    "counts %o as a filter, so an empty result says 'none match'",
    (sp) => {
      expect(parseTradeListQuery(sp, UB, NOW).filtersActive).toBe(true);
    },
  );
});
