"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import {
  Panel,
  PanelHeader,
  PanelBody,
  PanelFooter,
  Badge,
  Stat,
  StatRow,
  Money,
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  Button,
  useToast,
} from "@/components/ui";
import { AccountFormDialog, type EditableAccount } from "./account-form-dialog";
import { BalanceEventsDialog, type BalanceEventRow } from "./balance-events-dialog";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { archiveAccount, setActiveAccount } from "@/lib/actions/accounts";

export type AccountCardData = EditableAccount & {
  equity: string;
  netPnl: string;
  tradeCount: number;
  openCount: number;
  spark: number[];
  isArchived: boolean;
  deposits: string;
  withdrawals: string;
};

export function AccountCard({
  account,
  isActive,
  events,
}: {
  account: AccountCardData;
  isActive: boolean;
  events: BalanceEventRow[];
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [eventsOpen, setEventsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  async function handleSetActive() {
    setBusy(true);
    const result = await setActiveAccount(account.id);
    setBusy(false);
    if (result.ok) toast({ title: `${account.label} is now the active account.` });
    else toast({ title: "Could not switch account", description: result.formError, tone: "loss" });
  }

  async function handleArchiveToggle() {
    setBusy(true);
    const result = await archiveAccount(account.id, !account.isArchived);
    setBusy(false);
    if (result.ok) toast({ title: account.isArchived ? "Account restored." : "Account archived." });
    else toast({ title: "Could not update account", description: result.formError, tone: "loss" });
  }

  const netPnl = Number(account.netPnl);

  return (
    <Panel>
      <PanelHeader
        // `children` (rather than `title`) so an <Badge> can sit next to the
        // label — PanelHeader's `title` prop collides with the native HTML
        // `title` attribute's `string` type once intersected, so it only
        // ever accepts plain text.
        actions={
          <>
            <Badge tone={account.accountType === "LIVE" ? "brand" : "neutral"}>{account.accountType}</Badge>
            <Badge tone="outline">{account.platform}</Badge>
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Account actions" disabled={busy}>
                  <MoreHorizontal />
                </Button>
              </DropdownTrigger>
              <DropdownContent align="end">
                {!isActive && !account.isArchived ? (
                  <DropdownItem onSelect={handleSetActive}>Set as active</DropdownItem>
                ) : null}
                <DropdownItem onSelect={() => setEditOpen(true)}>Edit</DropdownItem>
                <DropdownItem onSelect={() => setEventsOpen(true)}>Balance events</DropdownItem>
                <DropdownSeparator />
                <DropdownItem onSelect={handleArchiveToggle}>
                  {account.isArchived ? "Unarchive" : "Archive"}
                </DropdownItem>
                <DropdownItem tone="danger" onSelect={() => setDeleteOpen(true)}>
                  Delete
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
          </>
        }
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
            {account.label}
            {isActive ? <Badge tone="brand">Active</Badge> : null}
          </h2>
          <span className="truncate text-xs text-ink-3">
            {[account.broker, account.currency].filter(Boolean).join(" · ")}
          </span>
        </div>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <StatRow>
          <Stat
            label="Equity"
            value={<Money value={account.equity} currency={account.currency} colour={false} />}
            spark={account.spark}
          />
          <Stat
            label="Realised P&L"
            value={<Money value={account.netPnl} currency={account.currency} signed />}
            tone={netPnl > 0 ? "profit" : netPnl < 0 ? "loss" : "neutral"}
          />
          <Stat label="Trades" value={String(account.tradeCount)} hint={`${account.openCount} open`} />
          <Stat
            label="Deposits"
            value={<Money value={account.deposits} currency={account.currency} colour={false} />}
          />
          <Stat
            label="Withdrawals"
            value={<Money value={account.withdrawals} currency={account.currency} colour={false} />}
          />
        </StatRow>
      </PanelBody>
      <PanelFooter>
        <span>
          Starting balance{" "}
          <Money value={account.startingBalance} currency={account.currency} colour={false} className="ml-1" />
        </span>
        {account.riskPerTradePct ? <span>{Number(account.riskPerTradePct).toFixed(2)}% risk / trade</span> : null}
      </PanelFooter>

      <AccountFormDialog open={editOpen} onOpenChange={setEditOpen} account={account} />
      <BalanceEventsDialog
        open={eventsOpen}
        onOpenChange={setEventsOpen}
        accountId={account.id}
        currency={account.currency}
        events={events}
      />
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} accountId={account.id} label={account.label} />
    </Panel>
  );
}
