import { describe, expect, it } from "vitest";
import { parseCandleCsv } from "./parse";

const UTC = { tzOffsetMinutes: 0 };

describe("parseCandleCsv — MT5 format", () => {
  const csv = [
    "<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>",
    "2024.01.02\t00:00:00\t1.10450\t1.10480\t1.10400\t1.10460\t120\t0\t8",
    "2024.01.02\t00:01:00\t1.10460\t1.10500\t1.10450\t1.10490\t95\t0\t9",
  ].join("\n");

  it("is detected as MT5 and parses both rows", () => {
    const result = parseCandleCsv(csv, UTC);
    expect(result.format).toBe("MT5");
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it("reads OHLC values as numbers", () => {
    const { rows } = parseCandleCsv(csv, UTC);
    expect(rows[0].open).toBe(1.1045);
    expect(rows[0].high).toBe(1.1048);
    expect(rows[0].low).toBe(1.104);
    expect(rows[0].close).toBe(1.1046);
  });

  it("maps tick volume onto volume, and spread onto spread", () => {
    const { rows } = parseCandleCsv(csv, UTC);
    expect(rows[0].volume).toBe(120);
    expect(rows[0].spread).toBe(8);
  });

  it("combines DATE and TIME as a UTC instant when tzOffsetMinutes is 0", () => {
    const { rows } = parseCandleCsv(csv, UTC);
    expect(rows[0].ts).toBe(Date.UTC(2024, 0, 2, 0, 0, 0));
    expect(rows[1].ts).toBe(Date.UTC(2024, 0, 2, 0, 1, 0));
  });

  it("shifts every bar by tzOffsetMinutes — a UTC+3 broker's midnight is 21:00 UTC the day before", () => {
    const { rows } = parseCandleCsv(csv, { tzOffsetMinutes: 180 });
    expect(rows[0].ts).toBe(Date.UTC(2024, 0, 1, 21, 0, 0));
  });

  it("handles a negative offset (e.g. UTC-5) the same way, in the other direction", () => {
    const { rows } = parseCandleCsv(csv, { tzOffsetMinutes: -300 });
    expect(rows[0].ts).toBe(Date.UTC(2024, 0, 2, 5, 0, 0));
  });

  it("throws if tzOffsetMinutes is missing/non-finite — it must never silently default", () => {
    // @ts-expect-error deliberately omitting the required option
    expect(() => parseCandleCsv(csv, {})).toThrow();
    expect(() => parseCandleCsv(csv, { tzOffsetMinutes: NaN })).toThrow();
  });
});

describe("parseCandleCsv — MT5 daily export (no <TIME> column)", () => {
  const csv = [
    "<DATE>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>",
    "2024.01.02\t1.10450\t1.10900\t1.10100\t1.10800\t48000\t0\t0",
    "2024.01.03\t1.10800\t1.11200\t1.10700\t1.11050\t51000\t0\t0",
  ].join("\n");

  it("parses without a time column, defaulting each bar to midnight", () => {
    const { rows, format } = parseCandleCsv(csv, UTC);
    expect(format).toBe("MT5");
    expect(rows).toHaveLength(2);
    expect(rows[0].ts).toBe(Date.UTC(2024, 0, 2, 0, 0, 0));
    expect(rows[1].ts).toBe(Date.UTC(2024, 0, 3, 0, 0, 0));
  });

  it("still applies tzOffsetMinutes to the midnight default", () => {
    const { rows } = parseCandleCsv(csv, { tzOffsetMinutes: 120 });
    expect(rows[0].ts).toBe(Date.UTC(2024, 0, 1, 22, 0, 0));
  });
});

describe("parseCandleCsv — generic OHLCV, comma-separated", () => {
  const csv = [
    "time,open,high,low,close,volume",
    "2024-01-02T00:00:00Z,1.1045,1.1048,1.1040,1.1046,120",
    "2024-01-02T00:01:00Z,1.1046,1.1050,1.1045,1.1049,95",
  ].join("\n");

  it("is detected as GENERIC", () => {
    const { format } = parseCandleCsv(csv, UTC);
    expect(format).toBe("GENERIC");
  });

  it("parses an ISO 8601 timestamp with an explicit Z as an absolute UTC instant", () => {
    const { rows } = parseCandleCsv(csv, UTC);
    expect(rows[0].ts).toBe(Date.UTC(2024, 0, 2, 0, 0, 0));
  });

  it("ignores tzOffsetMinutes for a timestamp that already carries an explicit offset", () => {
    const withOffset = parseCandleCsv(csv, { tzOffsetMinutes: 180 });
    const withoutOffset = parseCandleCsv(csv, UTC);
    expect(withOffset.rows[0].ts).toBe(withoutOffset.rows[0].ts);
  });

  it("matches header names case-insensitively", () => {
    const upper = csv.replace("time,open,high,low,close,volume", "TIME,OPEN,HIGH,LOW,CLOSE,VOLUME");
    const { rows } = parseCandleCsv(upper, UTC);
    expect(rows).toHaveLength(2);
  });

  it("reads volume", () => {
    const { rows } = parseCandleCsv(csv, UTC);
    expect(rows[0].volume).toBe(120);
  });
});

describe("parseCandleCsv — generic OHLCV, semicolon-separated with loose header names", () => {
  const csv = [
    "date;o;h;l;c;vol",
    "2024-01-02T00:00:00Z;1.1045;1.1048;1.1040;1.1046;120",
    "2024-01-02T00:01:00Z;1.1046;1.1050;1.1045;1.1049;95",
  ].join("\n");

  it("detects the semicolon delimiter and the abbreviated column names", () => {
    const { rows, format } = parseCandleCsv(csv, UTC);
    expect(format).toBe("GENERIC");
    expect(rows).toHaveLength(2);
    expect(rows[0].open).toBe(1.1045);
    expect(rows[0].volume).toBe(120);
  });
});

describe("parseCandleCsv — generic time column formats", () => {
  it("accepts epoch seconds", () => {
    const csv = ["time,open,high,low,close", "1704153600,1.1,1.2,1.05,1.15"].join("\n");
    const { rows } = parseCandleCsv(csv, UTC);
    expect(rows[0].ts).toBe(1704153600 * 1000);
  });

  it("accepts epoch milliseconds", () => {
    const csv = ["time,open,high,low,close", "1704153600000,1.1,1.2,1.05,1.15"].join("\n");
    const { rows } = parseCandleCsv(csv, UTC);
    expect(rows[0].ts).toBe(1704153600000);
  });

  it("accepts a naive datetime (no offset marker) and applies tzOffsetMinutes", () => {
    const csv = ["time,open,high,low,close", "2024-01-02 03:00:00,1.1,1.2,1.05,1.15"].join("\n");
    const { rows } = parseCandleCsv(csv, { tzOffsetMinutes: 180 });
    expect(rows[0].ts).toBe(Date.UTC(2024, 0, 2, 0, 0, 0));
  });

  it("accepts an ISO string with a non-Z explicit offset, ignoring tzOffsetMinutes", () => {
    const csv = ["time,open,high,low,close", "2024-01-02T03:00:00+03:00,1.1,1.2,1.05,1.15"].join("\n");
    const { rows } = parseCandleCsv(csv, { tzOffsetMinutes: 999 });
    expect(rows[0].ts).toBe(Date.UTC(2024, 0, 2, 0, 0, 0));
  });
});

describe("parseCandleCsv — validation", () => {
  function row(fields: Partial<{ ts: string; open: number; high: number; low: number; close: number }>) {
    const base = { ts: "2024-01-02T00:00:00Z", open: 1.1, high: 1.2, low: 1.05, close: 1.15 };
    const r = { ...base, ...fields };
    return `${r.ts},${r.open},${r.high},${r.low},${r.close}`;
  }
  const header = "time,open,high,low,close";

  it("skips a row where high < low", () => {
    const csv = [header, row({ high: 1.0, low: 1.05 })].join("\n");
    const { rows, skipped, warnings } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
    expect(warnings[0]).toMatch(/high below low/);
  });

  it("skips a row where high < open", () => {
    const csv = [header, row({ high: 1.05, open: 1.1 })].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a row where high < close", () => {
    const csv = [header, row({ high: 1.1, close: 1.15 })].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a row where low > open", () => {
    const csv = [header, row({ low: 1.12, open: 1.1 })].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a row where low > close", () => {
    const csv = [header, row({ low: 1.16, close: 1.15 })].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a zero-price row", () => {
    const csv = [header, row({ open: 0 })].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a negative-price row", () => {
    const csv = [header, row({ close: -1 })].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a duplicate timestamp (keeping the first occurrence)", () => {
    const csv = [header, "2024-01-02T00:00:00Z,1.1,1.2,1.05,1.15", "2024-01-02T00:00:00Z,1.11,1.21,1.06,1.16"].join(
      "\n",
    );
    const { rows, skipped, warnings } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(1);
    expect(rows[0].open).toBe(1.1);
    expect(skipped).toBe(1);
    expect(warnings.join(" ")).toMatch(/duplicate timestamp/);
  });

  it("skips an out-of-order (non-monotonic) timestamp", () => {
    const csv = [header, "2024-01-02T00:01:00Z,1.1,1.2,1.05,1.15", "2024-01-02T00:00:00Z,1.11,1.21,1.06,1.16"].join(
      "\n",
    );
    const { rows, skipped, warnings } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
    expect(warnings.join(" ")).toMatch(/non-monotonic/);
  });

  it("skips a row with an unparseable timestamp", () => {
    const csv = [header, "not-a-date,1.1,1.2,1.05,1.15"].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("caps the number of warnings but keeps the full skipped count, with a rollup message", () => {
    const lines = [header];
    for (let i = 0; i < 20; i++) lines.push(row({ high: 0.5 })); // every row invalid: high < low/open/close
    const { rows, skipped, warnings } = parseCandleCsv(lines.join("\n"), UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(20);
    expect(warnings.length).toBeLessThan(20);
    expect(warnings[warnings.length - 1]).toMatch(/more skipped row/);
  });

  it("counts good and bad rows independently in a mixed file", () => {
    const csv = [header, row({}), row({ high: 0.5 }), row({ ts: "2024-01-02T00:01:00Z" })].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(1);
  });
});

describe("parseCandleCsv — file hygiene", () => {
  it("handles CRLF line endings", () => {
    const csv = ["time,open,high,low,close", "2024-01-02T00:00:00Z,1.1,1.2,1.05,1.15"].join("\r\n");
    const { rows } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(1);
  });

  it("strips a UTF-8 BOM before parsing", () => {
    const csv = "﻿" + ["time,open,high,low,close", "2024-01-02T00:00:00Z,1.1,1.2,1.05,1.15"].join("\n");
    const { rows, format } = parseCandleCsv(csv, UTC);
    expect(format).toBe("GENERIC");
    expect(rows).toHaveLength(1);
  });

  it("returns an empty, non-throwing result for an empty file", () => {
    const { rows, skipped, warnings } = parseCandleCsv("", UTC);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("returns an empty, non-throwing result for whitespace-only input", () => {
    const { rows } = parseCandleCsv("   \n   \n", UTC);
    expect(rows).toHaveLength(0);
  });

  it("warns rather than throwing when required generic columns are missing", () => {
    const csv = ["foo,bar", "1,2"].join("\n");
    const { rows, warnings } = parseCandleCsv(csv, UTC);
    expect(rows).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
