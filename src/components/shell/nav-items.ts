import {
  BookOpen,
  ChartLine,
  Gauge,
  Settings,
  Table2,
  Wallet,
} from "lucide-react";

/**
 * The navigation, in the order a trading day actually runs: check the state of
 * the account, log what you did, study it, write it down, then the plumbing.
 * Grouping matters more than it looks — "Review" being separate from "Log" is
 * what stops analytics from feeling like a place you visit by accident.
 */
export const NAV_GROUPS = [
  {
    label: "Desk",
    items: [
      { href: "/", label: "Overview", icon: Gauge, exact: true },
      { href: "/trades", label: "Trades", icon: Table2 },
    ],
  },
  {
    label: "Review",
    items: [
      { href: "/analytics", label: "Analytics", icon: ChartLine },
      { href: "/journal", label: "Journal", icon: BookOpen },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/accounts", label: "Accounts", icon: Wallet },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

/** The four destinations that earn a slot in the mobile tab bar. */
export const MOBILE_NAV = [
  { href: "/", label: "Overview", icon: Gauge, exact: true },
  { href: "/trades", label: "Trades", icon: Table2 },
  { href: "/analytics", label: "Stats", icon: ChartLine },
  { href: "/journal", label: "Journal", icon: BookOpen },
] as const;

export function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
