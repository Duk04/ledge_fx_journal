"use client";

import * as React from "react";
import { signOutAction } from "@/lib/actions/auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { MOBILE_NAV, NAV_GROUPS, isActive } from "./nav-items";
import { AccountSwitcher, type AccountOption } from "./account-switcher";
import { ThemeToggle } from "./theme-toggle";
import { useStoredState } from "@/lib/use-stored-state";

const RAIL_KEY = "ledger.rail";

/** The rail is either collapsed ("1") or not ("0"). */
function isRailValue(v: string): v is "0" | "1" {
  return v === "0" || v === "1";
}

export function AppShell({
  user,
  accounts,
  activeAccountId,
  children,
}: {
  user: { name: string | null; email: string; timezone: string };
  accounts: AccountOption[];
  activeAccountId: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [rail, setRail] = useStoredState(RAIL_KEY, "0" as const, isRailValue);
  const collapsed = rail === "1";
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // "n" opens the new-trade form from anywhere. A journal is only useful if
  // logging a trade is faster than not bothering.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "n") {
        e.preventDefault();
        router.push("/trades/new");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {/* ---------------------------------------------------------------- top */}
      <header className="sticky top-0 z-30 flex h-topbar shrink-0 items-center gap-2 border-b border-line bg-panel/95 px-2.5 backdrop-blur-sm sm:px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={() => setMobileOpen((o) => !o)}
        >
          <Menu />
        </Button>

        <Link href="/" className="flex shrink-0 items-center gap-2 pr-1">
          <Wordmark />
        </Link>

        <div className="mx-1 hidden h-5 w-px bg-line sm:block" />

        <AccountSwitcher accounts={accounts} activeId={activeAccountId} />

        <div className="flex-1" />

        <Button asChild variant="primary" size="md" className="hidden sm:inline-flex">
          <Link href="/trades/new">
            <Plus /> Log trade
            <kbd className="ml-1 hidden rounded-[3px] bg-black/15 px-1 text-2xs font-normal md:inline">N</kbd>
          </Link>
        </Button>

        <ThemeToggle />

        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Account menu">
              <User />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end" className="w-56">
            <DropdownLabel>{user.name ?? user.email}</DropdownLabel>
            <div className="px-2 pb-1.5 text-2xs text-ink-3">{user.timezone}</div>
            <DropdownSeparator />
            <DropdownItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem asChild tone="danger">
              {/*
                A form, not a link to /api/auth/signout. That link was a GET
                navigation to Auth.js's own interstitial "are you sure?" page,
                so signing out took two clicks and landed on a page styled
                nothing like the rest of the app. A server action is one
                click, and Next applies its Origin check to it — whereas a
                GET endpoint that ends a session is exactly the shape a
                cross-site request can trigger from an <img> tag.
              */}
              <form action={signOutAction} className="contents">
                <button type="submit" className="flex w-full items-center gap-2">
                  <LogOut className="size-3.5" /> Sign out
                </button>
              </form>
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* --------------------------------------------------------------- rail */}
        <nav
          aria-label="Main"
          className={cn(
            "sticky top-topbar hidden h-[calc(100dvh-var(--topbar-h))] shrink-0 flex-col gap-4",
            "border-r border-line bg-panel px-2 py-3 lg:flex",
            "transition-[width] duration-[var(--dur)] ease-[var(--ease-out)]",
            collapsed ? "w-rail-collapsed" : "w-rail",
          )}
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              {!collapsed ? <span className="label px-2 pb-1">{group.label}</span> : null}
              {group.items.map((item) => (
                <RailLink
                  key={item.href}
                  {...item}
                  collapsed={collapsed}
                  active={isActive(pathname, item.href, "exact" in item ? item.exact : false)}
                />
              ))}
            </div>
          ))}

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => setRail(collapsed ? "0" : "1")}
            className={cn(
              "flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 text-ink-3",
              "hover:bg-hover hover:text-ink-2",
            )}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <>
                <PanelLeftClose className="size-4" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </button>
        </nav>

        {/* ------------------------------------------------------ mobile drawer */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-scrim"
              onClick={() => setMobileOpen(false)}
            />
            <nav
              aria-label="Main"
              className="absolute inset-y-0 left-0 flex w-64 flex-col gap-4 border-r border-line bg-panel px-2 py-3"
            >
              {NAV_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-0.5">
                  <span className="label px-2 pb-1">{group.label}</span>
                  {group.items.map((item) => (
                    <RailLink
                      key={item.href}
                      {...item}
                      onNavigate={() => setMobileOpen(false)}
                      active={isActive(pathname, item.href, "exact" in item ? item.exact : false)}
                    />
                  ))}
                </div>
              ))}
            </nav>
          </div>
        ) : null}

        {/* ------------------------------------------------------------ content */}
        <main className="min-w-0 flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</main>
      </div>

      {/* ------------------------------------------------------- mobile tab bar */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] items-start border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
      >
        {MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href, "exact" in item ? item.exact : false);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-14 flex-1 flex-col items-center justify-center gap-0.5",
                active ? "text-brand" : "text-ink-3",
              )}
            >
              <item.icon className="size-[1.15rem]" />
              <span className="text-2xs">{item.label}</span>
            </Link>
          );
        })}
        <Link
          href="/trades/new"
          aria-label="Log trade"
          className="mx-2 mt-2 grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand text-brand-ink"
        >
          <Plus className="size-5" />
        </Link>
      </nav>
    </div>
  );
}

function RailLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed?: boolean;
  /** Set by the mobile drawer so a tap closes it immediately. */
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-sm",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        active ? "bg-brand-weak text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
        collapsed && "justify-center px-0",
      )}
    >
      {/* The active marker is a 2px edge, not a filled pill: it reads at a
          glance without turning the rail into a stack of buttons. */}
      {active ? <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-brand" aria-hidden /> : null}
      <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "")} />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </Link>
  );

  return collapsed ? <Tip label={label}>{link}</Tip> : link;
}

/**
 * The wordmark: a candle glyph built from two rects and a wick. Drawn rather
 * than lettered so it survives at 16px in a browser tab.
 */
function Wordmark() {
  return (
    <span className="flex items-center gap-1.5">
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
        <line x1="5" y1="1.5" x2="5" y2="14.5" stroke="var(--profit)" strokeWidth="1.2" />
        <rect x="3" y="4" width="4" height="7" rx="0.5" fill="var(--profit)" />
        <line x1="11" y1="2.5" x2="11" y2="13.5" stroke="var(--ink-3)" strokeWidth="1.2" />
        <rect x="9" y="6" width="4" height="5" rx="0.5" fill="var(--ink-3)" />
      </svg>
      <span className="text-sm font-semibold tracking-[-0.02em] text-ink">Ledger</span>
    </span>
  );
}
