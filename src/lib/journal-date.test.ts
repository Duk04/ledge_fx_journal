import { describe, expect, it } from "vitest";
import { fromEntryDate, isJournalDate, toEntryDate } from "./journal-date";

describe("isJournalDate", () => {
  it("accepts a real calendar day", () => {
    expect(isJournalDate("2026-11-02")).toBe(true);
    expect(isJournalDate("2028-02-29")).toBe(true);
  });

  it.each(["2026-13-01", "2026-02-30", "2027-02-29", "2026-1-01", "", "2026-11-02T00:00:00Z", null, 20261102])(
    "refuses %s",
    (value) => {
      expect(isJournalDate(value)).toBe(false);
    },
  );
});

describe("toEntryDate / fromEntryDate", () => {
  it("round-trip through midnight UTC", () => {
    expect(toEntryDate("2026-11-02").toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(fromEntryDate(toEntryDate("2026-11-02"))).toBe("2026-11-02");
  });
});
