"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { deleteTrade, duplicateTrade } from "@/lib/actions/trades";

/**
 * A trade row's actions. Lives inside a table cell that is NOT the first
 * one — `TrLink` (see components/ui/table.tsx) overlays an invisible
 * full-row link, painted first in the DOM, so this just needs `relative` on
 * its own wrapper to sit above it; no click-hijacking required.
 */
export function TradeRowMenu({ accountId, tradeId }: { accountId: string; tradeId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  function handleDuplicate() {
    startTransition(async () => {
      const res = await duplicateTrade(accountId, tradeId);
      if (res.ok) {
        toast({ title: "Trade duplicated", description: "Opened as a new OPEN trade.", tone: "profit" });
        router.refresh();
      } else {
        toast({ title: "Couldn't duplicate trade", description: res.formError, tone: "loss" });
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteTrade(accountId, tradeId);
      setConfirmOpen(false);
      if (res.ok) {
        toast({ title: "Trade deleted" });
        router.refresh();
      } else {
        toast({ title: "Couldn't delete trade", description: res.formError, tone: "loss" });
      }
    });
  }

  return (
    <div className="relative inline-flex justify-end">
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Trade actions">
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end">
          <DropdownItem asChild>
            <Link href={`/trades/${tradeId}`}>View</Link>
          </DropdownItem>
          <DropdownItem asChild>
            <Link href={`/trades/${tradeId}/edit`}>Edit</Link>
          </DropdownItem>
          <DropdownItem
            disabled={pending}
            onSelect={(e) => {
              e.preventDefault();
              handleDuplicate();
            }}
          >
            Duplicate
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem
            tone="danger"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            Delete
          </DropdownItem>
        </DropdownContent>
      </Dropdown>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader
            title="Delete this trade?"
            description="This removes the trade and its attachments permanently. This can't be undone."
          />
          <DialogFooter>
            <Button variant="default" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
