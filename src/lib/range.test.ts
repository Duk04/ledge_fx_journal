import { describe, expect, it } from "vitest";
import { RANGE_OPTIONS, isRangeKey, resolveJournalRange, resolveRange } from "./range";

/**
 * `resolveRange` takes `now` as a parameter, which is what makes this
 * testable at all — and is worth preserving. Everything below pins a fixed
 * instant rather than reading the clock.
 */
const NOW = new Date("2026-09-08T10:30:00.000Z");
const DAY = 86_400_000;

describe("isRangeKey", () => {
  it("accepts every declared option", () => {
    for (const option of RANGE_OPTIONS) {
      expect(isRangeKey(option.value), option.value).toBe(true);
    }
  });

  it.each(["1d", "30D", "week", "", "null", "ALL"])("rejects %s", (value) => {
    expect(isRangeKey(value)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isRangeKey(undefined)).toBe(false);
  });

  it("is case-sensitive, matching the URL values the picker writes", () => {
    expect(isRangeKey("7d")).toBe(true);
    expect(isRangeKey("7D")).toBe(false);
  });
});

describe("resolveRange", () => {
  describe("rolling day windows", () => {
    it.each([
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
    ])("%s looks back %d days", (range, days) => {
      const { from, to } = resolveRange(range, "UTC", NOW);
      expect(from?.getTime()).toBe(NOW.getTime() - days * DAY);
      // `to` is always null: the window is "up to now", and pinning an end
      // would exclude a trade closed during the request.
      expect(to).toBeNull();
    });

    it("counts back from the given instant, not from midnight", () => {
      // Deliberate: "last 7 days" on a trading journal means the last 168
      // hours, so a trade from this morning is in the 7d window all day.
      const { from } = resolveRange("7d", "UTC", NOW);
      expect(from?.toISOString()).toBe("2026-09-01T10:30:00.000Z");
    });

    it("ignores the timezone for rolling windows, since an offset is absolute", () => {
      const utc = resolveRange("30d", "UTC", NOW);
      const ulaanbaatar = resolveRange("30d", "Asia/Ulaanbaatar", NOW);
      expect(utc.from?.getTime()).toBe(ulaanbaatar.from?.getTime());
    });
  });

  describe("all", () => {
    it("is an unbounded window at both ends", () => {
      expect(resolveRange("all", "UTC", NOW)).toEqual({ from: null, to: null });
    });
  });

  describe("ytd", () => {
    it("starts at January 1st in the account timezone", () => {
      const { from } = resolveRange("ytd", "UTC", NOW);
      expect(from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });

    it("is timezone-dependent, unlike the rolling windows", () => {
      // Ulaanbaatar is UTC+8, so its year starts eight hours before UTC's.
      // This is the reason the timezone is threaded through at all: a trade
      // closed at 23:00 local on Dec 31 belongs to the old year, and reading
      // "year to date" in UTC would pull it into the new one.
      const { from } = resolveRange("ytd", "Asia/Ulaanbaatar", NOW);
      expect(from?.toISOString()).toBe("2025-12-31T16:00:00.000Z");
    });

    it("handles a westward timezone", () => {
      // New York is UTC-5 in January, so its year starts five hours after.
      const { from } = resolveRange("ytd", "America/New_York", NOW);
      expect(from?.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    });

    it("uses the year as it is in the account timezone, not in UTC", () => {
      // 2026-01-01T02:00Z is still 2025-12-31 in New York, so YTD there
      // means "since Jan 1 2025", not 2026.
      const newYearInUtc = new Date("2026-01-01T02:00:00.000Z");
      expect(resolveRange("ytd", "UTC", newYearInUtc).from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(resolveRange("ytd", "America/New_York", newYearInUtc).from?.toISOString()).toBe(
        "2025-01-01T05:00:00.000Z",
      );
    });

    it("returns a PLAIN Date, not a TZDate", () => {
      // Not pedantry. TZDate extends Date and its getTime() is the correct
      // instant, but it overrides toISOString() and JSON serialisation to emit
      // an offset ("...+08:00") instead of a Z-suffixed UTC string. Every
      // DateTime column in this schema is TIMESTAMP(3) — no time zone — so a
      // subclass whose serialisation carries an offset is a silent
      // eight-hour shift waiting to happen the first time something stringifies
      // it on the way to the driver.
      const { from } = resolveRange("ytd", "Asia/Ulaanbaatar", NOW);
      expect(from?.constructor).toBe(Date);
      expect(from?.toISOString()).toBe("2025-12-31T16:00:00.000Z");
      expect(JSON.parse(JSON.stringify({ from }))).toEqual({ from: "2025-12-31T16:00:00.000Z" });
    });

    it("is unaffected by DST, since January 1st is outside it either way", () => {
      const { from } = resolveRange("ytd", "Europe/London", NOW);
      expect(from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("defaulting", () => {
    it("falls back to 30d for an unrecognised value", () => {
      const fallback = resolveRange("nonsense", "UTC", NOW);
      expect(fallback.from?.getTime()).toBe(NOW.getTime() - 30 * DAY);
    });

    it("falls back to 30d for undefined", () => {
      const fallback = resolveRange(undefined, "UTC", NOW);
      expect(fallback.from?.getTime()).toBe(NOW.getTime() - 30 * DAY);
    });

    it("never returns an unbounded window by accident", () => {
      // "all" has to be asked for explicitly: silently widening to every
      // trade ever would make an unrecognised URL param quietly change what
      // every statistic on the page means.
      for (const value of ["nonsense", undefined, "", "ALL"]) {
        expect(resolveRange(value, "UTC", NOW).from, String(value)).not.toBeNull();
      }
    });
  });

  describe("RANGE_OPTIONS", () => {
    it("resolves every option to a usable window", () => {
      for (const { value } of RANGE_OPTIONS) {
        const window = resolveRange(value, "UTC", NOW);
        expect(window.to, value).toBeNull();
        if (value !== "all") expect(window.from, value).toBeInstanceOf(Date);
      }
    });

    it("is ordered shortest to longest, which is what the picker renders", () => {
      expect(RANGE_OPTIONS.map((o) => o.value)).toEqual(["7d", "30d", "90d", "ytd", "all"]);
    });
  });
});

describe("resolveJournalRange", () => {
  // 2026-10-17 01:00 in Ulaanbaatar is still the 16th in UTC.
  const now = new Date("2026-10-16T17:00:00Z");
  const TZ = "Asia/Ulaanbaatar";

  it("defaults to the same day last month through today, in the user's zone", () => {
    const r = resolveJournalRange({}, TZ, now);
    expect([r.from, r.to, r.preset]).toEqual(["2026-09-17", "2026-10-17", "lastMonth"]);
    expect(r.window.from.toISOString()).toBe("2026-09-16T16:00:00.000Z");
    expect(r.window.to.toISOString()).toBe("2026-10-17T15:59:59.999Z");
  });

  it("names the preset that matches custom dates, and none otherwise", () => {
    expect(resolveJournalRange({ from: "2026-10-10", to: "2026-10-17" }, TZ, now).preset).toBe("lastWeek");
    expect(resolveJournalRange({ from: "2026-10-17", to: "2026-10-17" }, TZ, now).preset).toBe("today");
    expect(resolveJournalRange({ from: "2026-10-01", to: "2026-10-05" }, TZ, now).preset).toBeNull();
  });

  it("falls back on malformed, impossible or reversed dates", () => {
    for (const p of [
      { from: "x", to: "2026-10-05" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-10-05", to: "2026-10-01" },
    ]) {
      expect(resolveJournalRange(p, TZ, now).preset).toBe("lastMonth");
    }
  });

  it("returns plain Dates, not TZDates", () => {
    const r = resolveJournalRange({}, TZ, now);
    expect(r.window.from.constructor).toBe(Date);
  });
});
