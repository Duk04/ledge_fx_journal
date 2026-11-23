import { describe, expect, it } from "vitest";
import { MOBILE_NAV, NAV_GROUPS, activeHref } from "./nav-items";

const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href as string));

describe("activeHref", () => {
  it("picks the most specific item, so Import does not light Trades up too", () => {
    expect(activeHref("/trades/import")).toBe("/trades/import");
    expect(activeHref("/trades")).toBe("/trades");
  });

  it("keeps a page under an item on that item", () => {
    expect(activeHref("/trades/new")).toBe("/trades");
    expect(activeHref("/trades/abc-123/edit")).toBe("/trades");
    expect(activeHref("/backtest/replay")).toBe("/backtest");
  });

  it("matches the overview only at the root", () => {
    expect(activeHref("/")).toBe("/");
    // "/" is a prefix of every path; it must not claim them.
    expect(activeHref("/design")).toBeNull();
  });

  it("does not match on a shared string prefix alone", () => {
    expect(activeHref("/tradesmen")).toBeNull();
  });
});

describe("NAV_GROUPS", () => {
  it("hides nothing for good: every destination is still listed", () => {
    // Hidden behind "More tools", not removed. The command palette reads this
    // list, so an item dropped here is unreachable without typing its URL.
    expect([...hrefs].sort()).toEqual(
      [
        "/",
        "/accounts",
        "/analytics",
        "/backtest",
        "/calculator",
        "/journal",
        "/playbooks",
        "/settings",
        "/simulate",
        "/trades",
        "/trades/import",
      ].sort(),
    );
  });

  it("collapses only the secondary group", () => {
    expect(NAV_GROUPS.filter((g) => g.collapsible).map((g) => g.label)).toEqual(["more"]);
  });

  it("gives the phone tab bar the always-visible items", () => {
    expect(MOBILE_NAV.map((i) => i.href)).toEqual(["/", "/trades", "/trades/import"]);
  });
});
