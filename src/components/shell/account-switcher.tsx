"use client";

import { useRouter } from "next/navigation";
import { setActiveAccount } from "@/lib/actions/accounts";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { Sparkline } from "@/components/ui/sparkline";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/metrics/formatters";

export type AccountOption = {
  id: string;
  label: string;
  accountType: string;
  currency: string;
  equity: string;
  netPnl: string;
  spark: number[];
};

/**
 * The account switcher carries the current equity and its recent shape. That is
 * deliberate: switching account is rare, but wanting to know "where am I right
 * now" is constant, and this control is already in the corner of every page.
 */
export function AccountSwitcher({ accounts, activeId }: { accounts: AccountOption[]; activeId: string | null }) {
  const router = useRouter();
  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];

  // The cookie is set by a server action rather than written here, so the
  // account is validated against ownership before it is remembered — a
  // client-written cookie is just a user-editable string.
  function select(id: string) {
    void setActiveAccount(id).then(() => router.refresh());
  }

  if (!active) {
    return (
      <Link
        href="/accounts"
        className="flex h-control items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-line-strong px-2.5 text-xs text-ink-2 hover:bg-hover"
      >
        <Plus className="size-3.5" /> Add an account
      </Link>
    );
  }

  const pnl = Number(active.netPnl);

  return (
    <Dropdown>
      <DropdownTrigger
        className={cn(
          "group flex h-control min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] border border-line",
          "bg-panel pl-2.5 pr-2 text-left transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "hover:border-line-strong hover:bg-hover",
        )}
      >
        <span className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-xs font-medium text-ink">{active.label}</span>
          <span className={cn("mono mt-0.5 text-2xs", pnl > 0 ? "text-profit" : pnl < 0 ? "text-loss" : "text-ink-3")}>
            {formatMoney(Number(active.equity), active.currency)}
          </span>
        </span>
        <Sparkline values={active.spark} width={44} height={18} area={false} className="hidden sm:block" />
        <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3 group-hover:text-ink-2" />
      </DropdownTrigger>

      <DropdownContent align="start" className="w-72">
        <DropdownLabel>Accounts</DropdownLabel>
        {accounts.map((a) => {
          const p = Number(a.netPnl);
          return (
            <DropdownItem key={a.id} onSelect={() => select(a.id)} className="flex items-center gap-2.5 py-1.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm text-ink">{a.label}</span>
                  <Badge tone={a.accountType === "LIVE" ? "brand" : "neutral"} className="shrink-0">
                    {a.accountType}
                  </Badge>
                </span>
                <span className="mono text-2xs text-ink-3">
                  {formatMoney(Number(a.equity), a.currency)}
                  <span className={cn("ml-1.5", p > 0 ? "text-profit" : p < 0 ? "text-loss" : "")}>
                    {p > 0 ? "+" : ""}
                    {formatMoney(p, a.currency)}
                  </span>
                </span>
              </span>
              <Sparkline values={a.spark} width={40} height={16} area={false} />
              {a.id === active.id ? <Check className="size-3.5 shrink-0 text-brand" /> : null}
            </DropdownItem>
          );
        })}
        <DropdownSeparator />
        <DropdownItem asChild>
          <Link href="/accounts" className="flex items-center gap-2">
            <Plus className="size-3.5" /> Manage accounts
          </Link>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
