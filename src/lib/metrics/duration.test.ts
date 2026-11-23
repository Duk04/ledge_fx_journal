import { describe, expect, it } from "vitest";
import { DURATION_BUCKETS, groupByDuration } from "./duration";

const held = (...minutes: (number | null | undefined)[]) => minutes.map((holdingMinutes) => ({ holdingMinutes }));

const counts = (minutes: (number | null | undefined)[]) =>
  Object.fromEntries(groupByDuration(held(...minutes)).map((b) => [b.key, b.rows.length]));

describe("groupByDuration", () => {
  it("returns every bucket, in order, even with nothing in it", () => {
    const groups = groupByDuration([]);
    expect(groups.map((g) => g.key)).toEqual(DURATION_BUCKETS.map((b) => b.key));
    expect(groups.every((g) => g.rows.length === 0)).toBe(true);
  });

  it("puts a trade held exactly at an edge in the longer bucket", () => {
    // Upper edges are exclusive: 15 minutes is "15–60m", not "<15m".
    expect(counts([14, 15, 59, 60, 239, 240, 1439, 1440])).toEqual({
      lt15m: 1,
      "15m-1h": 2,
      "1h-4h": 2,
      "4h-1d": 2,
      gt1d: 1,
    });
  });

  it("counts a zero-minute scalp as under 15 minutes", () => {
    expect(counts([0]).lt15m).toBe(1);
  });

  it("has no upper limit on the last bucket", () => {
    expect(counts([1441, 100_000]).gt1d).toBe(2);
  });

  it("leaves out rows with no holding time", () => {
    const groups = groupByDuration(held(null, undefined, 5));
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(1);
  });

  it("leaves out a negative holding time rather than calling it short", () => {
    // A close before the open is bad data, not a fast trade.
    expect(Object.values(counts([-3])).every((n) => n === 0)).toBe(true);
  });

  it("keeps the caller's rows intact", () => {
    const rows = [{ holdingMinutes: 30, id: "a" }];
    expect(groupByDuration(rows)[1].rows[0]).toBe(rows[0]);
  });
});
