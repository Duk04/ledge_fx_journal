"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import {
  Button,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  useToast,
} from "@/components/ui";
import { deleteRun } from "@/lib/actions/backtests";

/** Row actions for one backtest run — currently just delete, but a dropdown
 * (rather than a bare button) leaves room for "duplicate settings" etc.
 * later without another table-layout change. */
export function RunRowMenu({ runId, label }: { runId: string; label: string | null }) {
  const t = useTranslations("backtest");
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteRun(runId);
      setConfirmOpen(false);
      if (res.ok) {
        toast({ title: t("runMenu.deleted") });
        router.refresh();
      } else {
        toast({ title: t("runMenu.couldNotDelete"), description: res.formError, tone: "loss" });
      }
    });
  }

  return (
    <div className="relative inline-flex justify-end">
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("runMenu.actions")}>
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end">
          <DropdownItem
            tone="danger"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            {t("common.delete")}
          </DropdownItem>
        </DropdownContent>
      </Dropdown>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader
            title={t("runMenu.deleteTitle")}
            description={t("runMenu.deleteDescription", { label: label ?? t("runMenu.thisRun") })}
          />
          <DialogFooter>
            <Button variant="default" onClick={() => setConfirmOpen(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={pending}>
              {pending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
