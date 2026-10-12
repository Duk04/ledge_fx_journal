import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { diffRules, playbookStats, type PlaybookTrade } from "./playbook-stats";

const row = (pnl: number) => ({
  netPnl: new Decimal(pnl),
  rMultiple: new Decimal(pnl / 100),
  outcome: pnl > 0 ? ("WIN" as const) : ("LOSS" as const),
  openedAt: new Date(),
  closedAt: new Date(),
  holdingMinutes: 60,
});
const t = (pnl: number, checks: [string, boolean][]): PlaybookTrade => ({
  row: row(pnl),
  checks: checks.map(([ruleId, followed]) => ({ ruleId, followed })),
});

describe("playbookStats", () => {
  const rules = ["a", "b"];
  const trades = [
    t(200, [
      ["a", true],
      ["b", true],
    ]), // by the book
    t(150, [
      ["a", true],
      ["b", true],
    ]), // by the book
    t(-100, [
      ["a", false],
      ["b", true],
    ]), // broke a rule
    t(-100, [["a", true]]), // half answered, no "no": neither group
  ];
  const s = playbookStats(rules, trades);

  it("splits by-the-book trades from rule-breaking ones", () => {
    expect(s.byTheBook.tradeCount).toBe(2);
    expect(s.byTheBook.netPnl.toString()).toBe("350");
    expect(s.brokeARule.tradeCount).toBe(1);
    expect(s.all.tradeCount).toBe(4);
  });

  it("measures compliance over answered checks only", () => {
    expect(s.compliance).toBeCloseTo(6 / 7);
    expect(s.rules).toEqual([
      { ruleId: "a", answered: 4, followed: 3 },
      { ruleId: "b", answered: 3, followed: 3 },
    ]);
  });

  it("ignores checks for rules no longer in the playbook", () => {
    expect(
      playbookStats(
        ["a"],
        [
          t(100, [
            ["gone", false],
            ["a", true],
          ]),
        ],
      ).brokeARule.tradeCount,
    ).toBe(0);
  });
});

describe("diffRules", () => {
  it("keeps ids of unchanged rules across a reorder, creates new text, removes the rest", () => {
    const d = diffRules(
      [
        { id: "1", text: "Trend agrees" },
        { id: "2", text: "Risk ≤ 1%" },
        { id: "3", text: "No news" },
      ],
      ["Risk ≤ 1%", "  Trend agrees ", "Clean retest", ""],
    );
    expect(d.keep).toEqual([
      { id: "2", sortOrder: 0 },
      { id: "1", sortOrder: 1 },
    ]);
    expect(d.create).toEqual([{ text: "Clean retest", sortOrder: 2 }]);
    expect(d.remove).toEqual(["3"]);
  });
});
