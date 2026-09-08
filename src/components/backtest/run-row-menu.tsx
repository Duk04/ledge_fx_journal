"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteRun(runId);
      setConfirmOpen(false);
      if (res.ok) {
        toast({ title: "Run deleted" });
        router.refresh();
      } else {
        toast({ title: "Couldn't delete run", description: res.formError, tone: "loss" });
      }
    });
  }

  return (
    <div className="relative inline-flex justify-end">
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Run actions">
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
            Delete
          </DropdownItem>
        </DropdownContent>
      </Dropdown>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader
            title="Delete this run?"
            description={`Permanently delete "${label ?? "this run"}" and every trade it produced. This can't be undone.`}
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
