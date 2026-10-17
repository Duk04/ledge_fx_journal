"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, Pencil, Trash2, X as CloseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { closeRTrade, closeTrade, deleteTrade, duplicateTrade } from "@/lib/actions/trades";
import { resultForOutcome, outcomeFor, type ROutcome } from "./trade-form-values";

/** The trade detail header's actions: Edit/Duplicate/Delete always, plus a
 * "Close trade" shortcut for the common case (just an exit price and a
 * close time) when the trade is still OPEN. */
export function TradeDetailActions({
  accountId,
  tradeId,
  status,
  openLots,
  entryMode = "PRICE",
  plannedRR = null,
}: {
  accountId: string;
  tradeId: string;
  status: string;
  /** Lots still open — the close dialog's default, and its ceiling. */
  openLots: string;
  /** An R-mode trade closes with a result in R, not an exit price. */
  entryMode?: "PRICE" | "R_MULTIPLE";
  plannedRR?: string | null;
}) {
  const t = useTranslations("trades.detail.actions");
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);

  function handleDuplicate() {
    startTransition(async () => {
      const res = await duplicateTrade(accountId, tradeId);
      if (res.ok) {
        toast({ title: t("duplicated"), description: t("duplicatedDescription"), tone: "profit" });
        router.push(`/trades/${res.id}`);
      } else {
        toast({ title: t("duplicateFailed"), description: res.formError, tone: "loss" });
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteTrade(accountId, tradeId);
      if (res.ok) {
        toast({ title: t("deleted") });
        router.push("/trades");
      } else {
        setConfirmOpen(false);
        toast({ title: t("deleteFailed"), description: res.formError, tone: "loss" });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {status === "OPEN" ? (
        <Button variant="default" size="sm" onClick={() => setCloseOpen(true)}>
          <CloseIcon /> {t("closeTrade")}
        </Button>
      ) : null}
      <Button asChild variant="default" size="sm">
        <Link href={`/trades/${tradeId}/edit`}>
          <Pencil /> {t("edit")}
        </Link>
      </Button>
      <Button variant="default" size="sm" onClick={handleDuplicate} disabled={pending}>
        <Copy /> {t("duplicate")}
      </Button>
      <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)} disabled={pending}>
        <Trash2 /> {t("delete")}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader title={t("confirmTitle")} description={t("confirmDescription")} />
          <DialogFooter>
            <Button variant="default" onClick={() => setConfirmOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={pending}>
              {pending ? t("deleting") : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {entryMode === "R_MULTIPLE" ? (
        <CloseRTradeDialog
          open={closeOpen}
          onOpenChange={setCloseOpen}
          plannedRR={plannedRR ?? ""}
          onClose={async (input) => {
            const res = await closeRTrade(accountId, tradeId, input);
            if (res.ok) {
              setCloseOpen(false);
              toast({ title: t("closed") });
              router.refresh();
            }
            return res;
          }}
        />
      ) : (
        /* Keyed on the open size so a partial close resets the default to
          what is left, instead of offering the old size again. */
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
              toast({ title: partial ? t("partialClosed", { lots: input.volumeLots, openLots }) : t("closed") });
              router.refresh();
            }
            return res;
          }}
        />
      )}
    </div>
  );
}

/** Closing an R-mode trade: which way it went, in R, and when. */
function CloseRTradeDialog({
  open,
  onOpenChange,
  plannedRR,
  onClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plannedRR: string;
  onClose: (input: { resultR: string; closedAt: string }) => Promise<{
    ok: boolean;
    fieldErrors?: Record<string, string[]>;
    formError?: string;
  }>;
}) {
  const t = useTranslations("trades.detail.closeDialog");
  const tForm = useTranslations("trades.form");
  const [resultR, setResultR] = React.useState("");
  const [outcome, setOutcome] = React.useState<ROutcome | "">("");
  const [closedAt, setClosedAt] = React.useState(() => toDatetimeLocal(new Date()));
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const rInput = React.useRef<HTMLInputElement>(null);

  function pick(next: ROutcome) {
    setOutcome(next);
    const r = resultForOutcome(next, plannedRR);
    if (r !== undefined) setResultR(r);
    else rInput.current?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    const closedAtIso = closedAt ? new Date(closedAt).toISOString() : "";
    const res = await onClose({ resultR, closedAt: closedAtIso });
    setSubmitting(false);
    if (!res.ok && res.fieldErrors) setErrors(res.fieldErrors);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader title={t("title")} description={t("descriptionR")} />
          <div className="flex flex-col gap-3 p-4">
            <Field>
              <FieldLabel>{tForm("outcome")}</FieldLabel>
              <Segmented value={outcome} onValueChange={(v) => v && pick(v as ROutcome)}>
                <SegmentedItem value="WIN">{tForm("outcomeWin")}</SegmentedItem>
                <SegmentedItem value="LOSS">{tForm("outcomeLoss")}</SegmentedItem>
                <SegmentedItem value="BREAKEVEN">{tForm("outcomeBreakeven")}</SegmentedItem>
                <SegmentedItem value="CUSTOM">{tForm("outcomeCustom")}</SegmentedItem>
              </Segmented>
            </Field>
            <Field>
              <FieldLabel>{tForm("resultR")}</FieldLabel>
              <NumberInput
                ref={rInput}
                value={resultR}
                onChange={(e) => {
                  setResultR(e.target.value);
                  setOutcome(outcomeFor(e.target.value, plannedRR) || "CUSTOM");
                }}
                unit="R"
                placeholder="2.5"
                aria-invalid={!!errors.resultR}
              />
              <FieldHint>{tForm("resultRHint")}</FieldHint>
              <FieldError>{errors.resultR?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("closedAt")}</FieldLabel>
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
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const t = useTranslations("trades.detail.closeDialog");
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
          <DialogHeader title={t("title")} description={t("description")} />
          <div className="flex flex-col gap-3 p-4">
            <Field>
              <FieldLabel>{t("exitPrice")}</FieldLabel>
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
              <FieldLabel>{t("lotsToClose")}</FieldLabel>
              <NumberInput
                value={volumeLots}
                onChange={(e) => setVolumeLots(e.target.value)}
                unit={t("ofOpen", { openLots })}
                aria-invalid={!!errors.volumeLots}
              />
              <FieldHint>{t("lotsHint")}</FieldHint>
              <FieldError>{errors.volumeLots?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("closedAt")}</FieldLabel>
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
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? t("submitting") : t("submit")}
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
