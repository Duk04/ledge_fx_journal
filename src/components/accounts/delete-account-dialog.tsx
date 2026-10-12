"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("accounts.delete");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { toast } = useToast();

  async function handleDelete() {
    setPending(true);
    setError(null);
    const result = await deleteAccount(accountId);
    setPending(false);
    if (result.ok) {
      toast({ title: t("toastDeleted") });
      onOpenChange(false);
    } else {
      setError(result.formError ?? t("failed"));
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
        <DialogHeader title={t("title")} description={t("description", { label })} />
        <DialogBody>
          {error ? (
            <p className="rounded-control border border-loss/35 bg-loss-weak px-2.5 py-2 text-xs text-loss">{error}</p>
          ) : (
            <p className="text-xs text-ink-3">{t("explain")}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} disabled={pending}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
