import {
  BookMarked,
  BookOpen,
  Calculator,
  ChartLine,
  Dices,
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
 * The navigation, in the order a trading day actually runs: check the state of
 * the account, log what you did, study it, write it down, then the plumbing.
 * Grouping matters more than it looks — "Review" being separate from "Log" is
 * what stops analytics from feeling like a place you visit by accident.
 */
export const NAV_GROUPS = [
  {
    label: "desk",
    items: [
      { href: "/", label: "overview", icon: Gauge, exact: true },
      { href: "/trades", label: "trades", icon: Table2 },
      { href: "/calculator", label: "positionSize", icon: Calculator },
    ],
  },
  {
    label: "review",
    items: [
      { href: "/analytics", label: "analytics", icon: ChartLine },
      { href: "/playbooks", label: "playbooks", icon: BookMarked },
      { href: "/simulate", label: "simulate", icon: Dices },
      { href: "/journal", label: "journal", icon: BookOpen },
      { href: "/backtest", label: "backtest", icon: FlaskConical },
    ],
  },
  {
    label: "setup",
    items: [
      { href: "/accounts", label: "accounts", icon: Wallet },
      { href: "/settings", label: "settings", icon: Settings },
    ],
  },
] as const;

/** The four destinations that earn a slot in the mobile tab bar. */
export const MOBILE_NAV = [
  { href: "/", label: "overview", icon: Gauge, exact: true },
  { href: "/trades", label: "trades", icon: Table2 },
  { href: "/analytics", label: "stats", icon: ChartLine },
  { href: "/journal", label: "journal", icon: BookOpen },
] as const;

export function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
