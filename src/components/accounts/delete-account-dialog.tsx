"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, Button, useToast } from "@/components/ui";
import { deleteAccount } from "@/lib/actions/accounts";

/**
 * Deletion is refused server-side whenever the account still has trades (see
 * docs/JOURNAL.md) — this dialog just surfaces whatever the action says
 * rather than trying to predict it, since the trade count could change
 * between page load and click. Fully controlled — see the comment on
 * AccountFormDialog for why (opened from a Dropdown menu item).
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  accountId,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  label: string;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { toast } = useToast();

  async function handleDelete() {
    setPending(true);
    setError(null);
    const result = await deleteAccount(accountId);
    setPending(false);
    if (result.ok) {
      toast({ title: "Account deleted." });
      onOpenChange(false);
    } else {
      setError(result.formError ?? "Could not delete this account.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent size="sm">
        <DialogHeader title="Delete account" description={`Permanently delete "${label}"? This cannot be undone.`} />
        <DialogBody>
          {error ? (
            <p className="rounded-control border border-loss/35 bg-loss-weak px-2.5 py-2 text-xs text-loss">{error}</p>
          ) : (
            <p className="text-xs text-ink-3">
              This only works for accounts with no trades. Accounts with trading history should be archived instead, so
              the history stays intact.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} disabled={pending}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
