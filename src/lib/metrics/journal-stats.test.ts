import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  bestAndWorst,
  bestDay,
  cumulativePnl,
  dailyBalance,
  dayWinRate,
  directionSplit,
  durationsByOutcome,
  totalLots,
  weekdayHighlights,
  weekdayStats,
  type JournalRow,
} from "./journal-stats";
import type { DailyPnl, EquityPoint } from "./types";

const TZ = "Asia/Ulaanbaatar";

function row(id: string, netPnl: number | null, closedAt: string | null, extra: Partial<JournalRow> = {}): JournalRow {
  const n = netPnl === null ? null : new Decimal(netPnl);
  return {
    id,
    symbol: "EURUSD",
    direction: "LONG",
    entryPrice: null,
    exitPrice: null,
    volumeLots: null,
    netPnl: n,
    rMultiple: null,
    outcome: n === null ? "OPEN" : n.gt(0) ? "WIN" : n.lt(0) ? "LOSS" : "BREAKEVEN",
    openedAt: new Date("2026-09-01T00:00:00Z"),
    closedAt: closedAt ? new Date(closedAt) : null,
    holdingMinutes: null,
    ...extra,
  };
}

const day = (date: string, pnl: number): DailyPnl => ({ date, netPnl: new Decimal(pnl), tradeCount: 1 });

describe("dayWinRate", () => {
  it("counts green and red days, leaving scratch days out of both", () => {
    expect(dayWinRate([day("a", 10), day("b", -5), day("c", 0), day("d", 3)])).toEqual({
      greenDays: 2,
      redDays: 1,
      rate: 2 / 3,
    });
  });

  it("is null with no decided days", () => {
    expect(dayWinRate([day("a", 0)]).rate).toBeNull();
  });
});

describe("bestDay", () => {
  it("reports the best day as a share of net P&L — more than 100% when other days lost", () => {
    const best = bestDay([day("a", 2190.14), day("b", -2101.48)], new Decimal("88.66"))!;
    expect(best.date).toBe("a");
    expect(best.shareOfNet!.toFixed(4)).toBe("24.7027");
  });

  it("has no share of a losing period", () => {
    expect(bestDay([day("a", 5)], new Decimal(-10))!.shareOfNet).toBeNull();
  });
});

describe("weekdayStats", () => {
  // 2026-09-09 is a Wednesday. 20:00Z is 04:00 Thursday in Ulaanbaatar.
  const rows = [
    row("1", 100, "2026-09-09T02:00:00Z"),
    row("2", 50, "2026-09-09T03:00:00Z"),
    row("3", -40, "2026-09-09T20:00:00Z"),
    row("4", null, null),
  ];

  it("buckets by local close day, and only weekdays that traded", () => {
    const stats = weekdayStats(rows, TZ);
    expect(stats.map((s) => [s.weekday, s.trades, s.activeDays, s.netPnl.toNumber()])).toEqual([
      ["WEDNESDAY", 2, 1, 150],
      ["THURSDAY", 1, 1, -40],
    ]);
  });

  it("ranks most active, most and least profitable", () => {
    const h = weekdayHighlights(weekdayStats(rows, TZ));
    expect(h.mostActive?.weekday).toBe("WEDNESDAY");
    expect(h.mostProfitable?.weekday).toBe("WEDNESDAY");
    expect(h.leastProfitable?.weekday).toBe("THURSDAY");
  });
});

describe("trade stats", () => {
  const rows = [
    row("w", 300, "2026-09-09T02:00:00Z", { holdingMinutes: 240 }),
    row("l", -100, "2026-09-09T03:00:00Z", { holdingMinutes: 60, direction: "SHORT" }),
    row("o", null, null, { holdingMinutes: null }),
  ];

  it("averages durations by outcome", () => {
    expect(durationsByOutcome(rows)).toEqual({ all: 150, wins: 240, losses: 60 });
  });

  it("splits direction over closed trades", () => {
    expect(directionSplit(rows)).toEqual({ long: 1, short: 1, longShare: 0.5 });
  });

  it("finds the best and worst trade, and no 'worst' in an all-green set", () => {
    expect(bestAndWorst(rows)).toMatchObject({ best: { id: "w" }, worst: { id: "l" } });
    expect(bestAndWorst([rows[0]]).worst).toBeNull();
  });
});

describe("dailyBalance", () => {
  const point = (at: string, balance: number): EquityPoint => ({
    at: new Date(at),
    balance: new Decimal(balance),
    change: new Decimal(0),
    kind: "TRADE",
  });

  it("keeps each local day's last balance and opens the line at the period start", () => {
    const curve = [point("2026-09-09T02:00:00Z", 10100), point("2026-09-09T03:00:00Z", 10050)];
    expect(
      dailyBalance(curve, new Decimal(10000), "2026-09-01", TZ).map((p) => [p.date, p.balance.toNumber()]),
    ).toEqual([
      ["2026-09-01", 10000],
      ["2026-09-09", 10050],
    ]);
  });
});

describe("cumulativePnl", () => {
  it("is the running total of the days, in order", () => {
    const points = cumulativePnl([day("2026-09-08", 100.1), day("2026-09-09", -40.2), day("2026-09-11", 15)], null);
    // Decimal sums: 100.1 − 40.2 is 59.9, not the float's 59.89999999999999.
    expect(points.map((p) => [p.date, p.cumulative.toString()])).toEqual([
      ["2026-09-08", "100.1"],
      ["2026-09-09", "59.9"],
      ["2026-09-11", "74.9"],
    ]);
  });

  it("opens at zero on the range's first day when that is before the first trade", () => {
    const points = cumulativePnl([day("2026-09-09", 50)], "2026-09-01");
    expect(points.map((p) => [p.date, p.cumulative.toNumber()])).toEqual([
      ["2026-09-01", 0],
      ["2026-09-09", 50],
    ]);
  });

  it("adds no opening point on a day that already has one", () => {
    // Otherwise the first day would be drawn twice: once at zero, once at its close.
    expect(cumulativePnl([day("2026-09-01", 50)], "2026-09-01")).toHaveLength(1);
  });

  it("is just the opening point for a range with no trades", () => {
    expect(cumulativePnl([], "2026-09-01").map((p) => p.cumulative.toNumber())).toEqual([0]);
    expect(cumulativePnl([], null)).toEqual([]);
  });
});

describe("totalLots", () => {
  const lots = (v: string) => ({ volumeLots: new Decimal(v) });

  it("sums the sizes exactly", () => {
    const total = totalLots([
      row("a", 10, "2026-09-09T02:00:00Z", lots("0.1")),
      row("b", -5, "2026-09-09T03:00:00Z", lots("0.2")),
    ])!;
    // 0.1 + 0.2 in floats is 0.30000000000000004.
    expect(total.lots.toString()).toBe("0.3");
    expect(total.sized).toBe(2);
  });

  it("leaves a trade with no size out, and says how many it covered", () => {
    // An R-mode trade has no lot size. It is not zero lots.
    const total = totalLots([row("a", 10, "2026-09-09T02:00:00Z", lots("2")), row("r", 30, "2026-09-09T03:00:00Z")])!;
    expect(total.lots.toString()).toBe("2");
    expect(total.sized).toBe(1);
  });

  it("is null, not zero, when no trade in the range was sized", () => {
    expect(totalLots([row("r", 30, "2026-09-09T03:00:00Z")])).toBeNull();
    expect(totalLots([])).toBeNull();
  });

  it("counts closed trades only", () => {
    expect(totalLots([row("o", null, null, lots("5"))])).toBeNull();
  });
});
