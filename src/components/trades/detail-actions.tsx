"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Trash2, X as CloseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { closeTrade, deleteTrade, duplicateTrade } from "@/lib/actions/trades";

/** The trade detail header's actions: Edit/Duplicate/Delete always, plus a
 * "Close trade" shortcut for the common case (just an exit price and a
 * close time) when the trade is still OPEN. */
export function TradeDetailActions({
  accountId,
  tradeId,
  status,
  openLots,
}: {
  accountId: string;
  tradeId: string;
  status: string;
  /** Lots still open — the close dialog's default, and its ceiling. */
  openLots: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);

  function handleDuplicate() {
    startTransition(async () => {
      const res = await duplicateTrade(accountId, tradeId);
      if (res.ok) {
        toast({ title: "Trade duplicated", description: "Opened as a new OPEN trade.", tone: "profit" });
        router.push(`/trades/${res.id}`);
      } else {
        toast({ title: "Couldn't duplicate trade", description: res.formError, tone: "loss" });
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteTrade(accountId, tradeId);
      if (res.ok) {
        toast({ title: "Trade deleted" });
        router.push("/trades");
      } else {
        setConfirmOpen(false);
        toast({ title: "Couldn't delete trade", description: res.formError, tone: "loss" });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {status === "OPEN" ? (
        <Button variant="default" size="sm" onClick={() => setCloseOpen(true)}>
          <CloseIcon /> Close trade
        </Button>
      ) : null}
      <Button asChild variant="default" size="sm">
        <Link href={`/trades/${tradeId}/edit`}>
          <Pencil /> Edit
        </Link>
      </Button>
      <Button variant="default" size="sm" onClick={handleDuplicate} disabled={pending}>
        <Copy /> Duplicate
      </Button>
      <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)} disabled={pending}>
        <Trash2 /> Delete
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader
            title="Delete this trade?"
            description="This removes the trade and its attachments permanently."
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

      {/* Keyed on the open size so a partial close resets the default to
          what is left, instead of offering the old size again. */}
      <CloseTradeDialog
        key={openLots}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        openLots={openLots}
        onClose={async (input) => {
          const res = await closeTrade(accountId, tradeId, input);
          if (res.ok) {
            setCloseOpen(false);
            const partial = Number(input.volumeLots) < Number(openLots);
            toast({ title: partial ? `Closed ${input.volumeLots} of ${openLots} lots` : "Trade closed" });
            router.refresh();
          }
          return res;
        }}
      />
    </div>
  );
}

function CloseTradeDialog({
  open,
  onOpenChange,
  openLots,
  onClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openLots: string;
  onClose: (input: { exitPrice: string; closedAt: string; volumeLots: string }) => Promise<{
    ok: boolean;
    fieldErrors?: Record<string, string[]>;
    formError?: string;
  }>;
}) {
  const [exitPrice, setExitPrice] = React.useState("");
  const [volumeLots, setVolumeLots] = React.useState(openLots);
  const [closedAt, setClosedAt] = React.useState(() => toDatetimeLocal(new Date()));
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    const closedAtIso = closedAt ? new Date(closedAt).toISOString() : "";
    const res = await onClose({ exitPrice, closedAt: closedAtIso, volumeLots });
    setSubmitting(false);
    if (!res.ok && res.fieldErrors) setErrors(res.fieldErrors);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader
            title="Close trade"
            description="The exit price and close time — everything else stays as recorded."
          />
          <div className="flex flex-col gap-3 p-4">
            <Field>
              <FieldLabel>Exit price</FieldLabel>
              <NumberInput
                autoFocus
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                placeholder="0.00000"
                aria-invalid={!!errors.exitPrice}
              />
              <FieldError>{errors.exitPrice?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel>Lots to close</FieldLabel>
              <NumberInput
                value={volumeLots}
                onChange={(e) => setVolumeLots(e.target.value)}
                unit={`of ${openLots}`}
                aria-invalid={!!errors.volumeLots}
              />
              <FieldHint>Fewer than all of them is a partial close; the trade stays open.</FieldHint>
              <FieldError>{errors.volumeLots?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel>Closed at</FieldLabel>
              <Input
                type="datetime-local"
                value={closedAt}
                onChange={(e) => setClosedAt(e.target.value)}
                aria-invalid={!!errors.closedAt}
              />
              <FieldError>{errors.closedAt?.[0]}</FieldError>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="default" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Closing…" : "Close trade"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
