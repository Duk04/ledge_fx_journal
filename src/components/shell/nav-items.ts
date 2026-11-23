import {
  BookMarked,
  BookOpen,
  Calculator,
  ChartLine,
  Dices,
  FileUp,
  FlaskConical,
  Gauge,
  Settings,
  Table2,
  Wallet,
} from "lucide-react";

/**
 * `label`s are message keys under `nav` (messages/*.json), translated where
 * they render.
 *
 * Three things are always in sight, because they are the whole daily loop:
 * see how the account is doing, look at the trades, bring new ones in.
 * Everything else — the reports, the written journal, playbooks, what-ifs,
 * backtesting, the sizing calculator — is in `more`, a group the shell draws
 * collapsed (`collapsible`). Nothing was removed: ten equal destinations read
 * as ten things to learn before logging a trade, and that is what kept the
 * journal from being used. The command palette still lists every item.
 */
export const NAV_GROUPS = [
  {
    label: "desk",
    collapsible: false,
    items: [
      { href: "/", label: "overview", icon: Gauge },
      { href: "/trades", label: "trades", icon: Table2 },
      { href: "/trades/import", label: "import", icon: FileUp },
    ],
  },
  {
    label: "more",
    collapsible: true,
    items: [
      { href: "/analytics", label: "analytics", icon: ChartLine },
      { href: "/journal", label: "journal", icon: BookOpen },
      { href: "/playbooks", label: "playbooks", icon: BookMarked },
      { href: "/simulate", label: "simulate", icon: Dices },
      { href: "/backtest", label: "backtest", icon: FlaskConical },
      { href: "/calculator", label: "positionSize", icon: Calculator },
    ],
  },
  {
    label: "setup",
    collapsible: false,
    items: [
      { href: "/accounts", label: "accounts", icon: Wallet },
      { href: "/settings", label: "settings", icon: Settings },
    ],
  },
] as const;

/** The mobile tab bar: the always-visible group, and nothing else. The rest
 * is one tap away in the drawer. */
export const MOBILE_NAV = NAV_GROUPS[0].items;

const NAV_HREFS: readonly string[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));

/**
 * The one nav item `pathname` belongs to: the LONGEST href it sits at or
 * under, or null for a page the nav does not list.
 *
 * Longest, because items nest — `/trades/import` is under `/trades`, and a
 * plain prefix test lit both of them up. `/` is a prefix of nothing but
 * itself here (`"/" + "/"` never starts a real path), which is why it needs
 * no "exact" flag.
 */
export function activeHref(pathname: string, hrefs: readonly string[] = NAV_HREFS): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}
