"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  Field,
  FieldLabel,
  FieldError,
  FieldRow,
  Input,
  NumberInput,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Badge,
  Money,
  useToast,
} from "@/components/ui";
import { addBalanceEvent, deleteBalanceEvent, type BalanceEventInput } from "@/lib/actions/accounts";

export type BalanceEventRow = {
  id: string;
  kind: "DEPOSIT" | "WITHDRAWAL" | "ADJUSTMENT";
  amount: string;
  occurredAt: string; // ISO
  note: string | null;
};

type FormValues = { kind: BalanceEventRow["kind"]; amount: string; occurredAt: string; note: string };

const KIND_TONE: Record<BalanceEventRow["kind"], "profit" | "loss" | "neutral"> = {
  DEPOSIT: "profit",
  WITHDRAWAL: "loss",
  ADJUSTMENT: "neutral",
};

/** Fully controlled — see the comment on AccountFormDialog for why (opened from a Dropdown menu item). */
export function BalanceEventsDialog({
  open,
  onOpenChange,
  accountId,
  currency,
  events,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  currency: string;
  events: BalanceEventRow[];
}) {
  const t = useTranslations("accounts.events");
  const tEnum = useTranslations("enums");
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const { toast } = useToast();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<FormValues>({
    defaultValues: {
      kind: "DEPOSIT",
      amount: "",
      occurredAt: new Date().toISOString().slice(0, 10),
      note: "",
    },
  });
  const kind = useWatch({ control, name: "kind" });

  async function onSubmit(values: FormValues) {
    const input: BalanceEventInput = {
      kind: values.kind,
      amount: values.amount,
      occurredAt: values.occurredAt,
      note: values.note || undefined,
    };
    const result = await addBalanceEvent(accountId, input);
    if (result.ok) {
      toast({ title: t("toastAdded") });
      reset({ kind: values.kind, amount: "", occurredAt: values.occurredAt, note: "" });
    } else {
      if (result.formError) setError("root", { message: result.formError });
      for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
        setError(key as keyof FormValues, { message: messages[0] });
      }
    }
  }

  async function handleDelete(eventId: string) {
    setPendingDelete(eventId);
    const result = await deleteBalanceEvent(accountId, eventId);
    setPendingDelete(null);
    if (result.ok) toast({ title: t("toastRemoved") });
    else toast({ title: t("toastRemoveFailed"), description: result.formError, tone: "loss" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title={t("title")} description={t("description")} />
        <DialogBody className="flex flex-col gap-4">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3 border-b border-line pb-4">
            {errors.root?.message ? <p className="text-xs text-loss">{errors.root.message}</p> : null}
            <FieldRow className="sm:grid-cols-4">
              <Field className="sm:col-span-1">
                <FieldLabel>{t("kind")}</FieldLabel>
                <Controller
                  control={control}
                  name="kind"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DEPOSIT">{tEnum("balanceEventKind.DEPOSIT")}</SelectItem>
                        <SelectItem value="WITHDRAWAL">{tEnum("balanceEventKind.WITHDRAWAL")}</SelectItem>
                        <SelectItem value="ADJUSTMENT">{tEnum("balanceEventKind.ADJUSTMENT")}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field className="sm:col-span-1">
                <FieldLabel>{t("amount")}</FieldLabel>
                <NumberInput {...register("amount", { required: t("required") })} unit={currency} />
                <FieldError>{errors.amount?.message}</FieldError>
              </Field>
              <Field className="sm:col-span-1">
                <FieldLabel>{t("date")}</FieldLabel>
                <Input type="date" {...register("occurredAt", { required: t("required") })} />
              </Field>
              <Field className="sm:col-span-1">
                <FieldLabel optional>{t("note")}</FieldLabel>
                <Input {...register("note")} placeholder={t("notePlaceholder")} />
              </Field>
            </FieldRow>
            {kind === "ADJUSTMENT" ? <p className="text-2xs text-ink-3">{t("negativeHint")}</p> : null}
            <Button type="submit" variant="primary" size="sm" className="self-start" disabled={isSubmitting}>
              {t("add")}
            </Button>
          </form>

          {events.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-3">{t("empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-faint">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2">
                  <Badge tone={KIND_TONE[e.kind]} className="w-24 shrink-0 justify-center">
                    {e.kind}
                  </Badge>
                  <span className="mono w-24 shrink-0 text-xs text-ink-2">{e.occurredAt.slice(0, 10)}</span>
                  <Money value={e.amount} currency={currency} signed className="w-28 shrink-0 text-sm" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{e.note}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("deleteAria")}
                    disabled={pendingDelete === e.id}
                    onClick={() => handleDelete(e.id)}
                  >
                    <Trash2 className="text-loss" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
