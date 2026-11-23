import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { groupByTradeDay, tradeDayKey } from "./trade-days";
import type { TradeRow } from "./types";

const TZ = "Asia/Ulaanbaatar"; // UTC+8

function row(id: string, netPnl: number | null, openedAt: string, closedAt: string | null): TradeRow & { id: string } {
  const n = netPnl === null ? null : new Decimal(netPnl);
  return {
    id,
    netPnl: n,
    rMultiple: null,
    outcome: n === null ? "OPEN" : n.gt(0) ? "WIN" : n.lt(0) ? "LOSS" : "BREAKEVEN",
    openedAt: new Date(openedAt),
    closedAt: closedAt ? new Date(closedAt) : null,
  };
}

describe("tradeDayKey", () => {
  it("is the local day the trade closed, not the UTC one", () => {
    // 20:00Z on the 9th is 04:00 on the 10th in Ulaanbaatar.
    expect(tradeDayKey(row("a", 1, "2026-09-09T02:00:00Z", "2026-09-09T20:00:00Z"), TZ)).toBe("2026-09-10");
  });

  it("is the day it opened while it is still open", () => {
    expect(tradeDayKey(row("a", null, "2026-09-09T02:00:00Z", null), TZ)).toBe("2026-09-09");
  });
});

describe("groupByTradeDay", () => {
  it("puts a trade held overnight on the day it closed, as the calendar does", () => {
    const days = groupByTradeDay([row("overnight", 50, "2026-09-08T10:00:00Z", "2026-09-09T03:00:00Z")], TZ);
    expect(days.map((d) => d.date)).toEqual(["2026-09-09"]);
  });

  it("lists days newest first and a day's trades in the order they happened", () => {
    const days = groupByTradeDay(
      [
        row("late", 10, "2026-09-09T05:00:00Z", "2026-09-09T06:00:00Z"),
        row("old", 10, "2026-09-01T05:00:00Z", "2026-09-01T06:00:00Z"),
        row("early", 10, "2026-09-09T01:00:00Z", "2026-09-09T02:00:00Z"),
      ],
      TZ,
    );
    expect(days.map((d) => [d.date, d.rows.map((r) => r.id)])).toEqual([
      ["2026-09-09", ["early", "late"]],
      ["2026-09-01", ["old"]],
    ]);
  });

  it("sums a day exactly and counts wins and losses, a breakeven as neither", () => {
    const [day] = groupByTradeDay(
      [
        row("w", 100.1, "2026-09-09T01:00:00Z", "2026-09-09T02:00:00Z"),
        row("l", -40.2, "2026-09-09T03:00:00Z", "2026-09-09T04:00:00Z"),
        row("be", 0, "2026-09-09T05:00:00Z", "2026-09-09T06:00:00Z"),
      ],
      TZ,
    );
    // Decimal: 100.1 − 40.2 is 59.9, not the float's 59.89999999999999.
    expect(day.netPnl.toString()).toBe("59.9");
    expect([day.wins, day.losses, day.rows.length]).toEqual([1, 1, 3]);
  });

  it("lists an open trade under its day without adding to the day's result", () => {
    const [day] = groupByTradeDay(
      [
        row("closed", 25, "2026-09-09T01:00:00Z", "2026-09-09T02:00:00Z"),
        row("open", null, "2026-09-09T03:00:00Z", null),
      ],
      TZ,
    );
    expect(day.rows.map((r) => r.id)).toEqual(["closed", "open"]);
    expect(day.netPnl.toString()).toBe("25");
    expect([day.wins, day.losses]).toEqual([1, 0]);
  });

  it("does not reorder the caller's array", () => {
    const rows = [
      row("b", 1, "2026-09-09T05:00:00Z", "2026-09-09T06:00:00Z"),
      row("a", 1, "2026-09-09T01:00:00Z", "2026-09-09T02:00:00Z"),
    ];
    groupByTradeDay(rows, TZ);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("is empty for no trades", () => {
    expect(groupByTradeDay([], TZ)).toEqual([]);
  });
});
