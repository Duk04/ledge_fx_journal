"use client";

import { Controller, useForm } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
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
  Segmented,
  SegmentedItem,
  useToast,
} from "@/components/ui";
import { createAccount, updateAccount, type AccountInput } from "@/lib/actions/accounts";

type FormValues = {
  label: string;
  broker: string;
  platform: "MT5" | "MT4" | "CTRADER" | "OTHER";
  accountType: "DEMO" | "LIVE" | "PROP";
  currency: string;
  startingBalance: string;
  riskPerTradePct: string;
  dailyLossLimitPct: string;
  maxDrawdownPct: string;
  drawdownMode: "STATIC" | "TRAILING";
  profitTargetPct: string;
  minTradingDays: string;
};

const PLATFORMS: { value: FormValues["platform"]; label: string }[] = [
  { value: "MT5", label: "MetaTrader 5" },
  { value: "MT4", label: "MetaTrader 4" },
  { value: "CTRADER", label: "cTrader" },
  { value: "OTHER", label: "Other" },
];

const ACCOUNT_TYPES: { value: FormValues["accountType"]; label: string }[] = [
  { value: "DEMO", label: "Demo" },
  { value: "LIVE", label: "Live" },
  { value: "PROP", label: "Prop firm" },
];

export type EditableAccount = {
  id: string;
  label: string;
  broker: string | null;
  platform: string;
  accountType: string;
  currency: string;
  startingBalance: string;
  riskPerTradePct: string | null;
  dailyLossLimitPct: string | null;
  maxDrawdownPct: string | null;
  drawdownMode: "STATIC" | "TRAILING";
  profitTargetPct: string | null;
  minTradingDays: number | null;
};

/**
 * One dialog, two modes: create (no `account`) and edit (`account` supplied).
 * Fully controlled (`open`/`onOpenChange`) rather than owning its own
 * trigger — callers that open this from inside a Dropdown menu need the
 * dialog to keep rendering after the menu closes, which a `DialogTrigger`
 * nested inside a `DropdownItem` cannot reliably do.
 */
export function AccountFormDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: EditableAccount;
}) {
  const { toast } = useToast();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<FormValues>({
    defaultValues: account
      ? {
          label: account.label,
          broker: account.broker ?? "",
          platform: account.platform as FormValues["platform"],
          accountType: account.accountType as FormValues["accountType"],
          currency: account.currency,
          startingBalance: account.startingBalance,
          riskPerTradePct: account.riskPerTradePct ?? "",
          dailyLossLimitPct: account.dailyLossLimitPct ?? "",
          maxDrawdownPct: account.maxDrawdownPct ?? "",
          drawdownMode: account.drawdownMode,
          profitTargetPct: account.profitTargetPct ?? "",
          minTradingDays: account.minTradingDays === null ? "" : String(account.minTradingDays),
        }
      : {
          label: "",
          broker: "",
          platform: "MT5",
          accountType: "DEMO",
          currency: "USD",
          startingBalance: "10000",
          riskPerTradePct: "",
          dailyLossLimitPct: "",
          maxDrawdownPct: "",
          drawdownMode: "STATIC",
          profitTargetPct: "",
          minTradingDays: "",
        },
  });

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next && !account) reset();
  }

  async function onSubmit(values: FormValues) {
    const input: AccountInput = {
      label: values.label,
      broker: values.broker || undefined,
      platform: values.platform,
      accountType: values.accountType,
      currency: values.currency,
      startingBalance: values.startingBalance,
      riskPerTradePct: values.riskPerTradePct === "" ? undefined : values.riskPerTradePct,
      dailyLossLimitPct: values.dailyLossLimitPct,
      maxDrawdownPct: values.maxDrawdownPct,
      drawdownMode: values.drawdownMode,
      profitTargetPct: values.profitTargetPct,
      minTradingDays: values.minTradingDays,
    };

    const result = account ? await updateAccount(account.id, input) : await createAccount(input);

    if (result.ok) {
      toast({ title: account ? "Account updated." : "Account created." });
      handleOpenChange(false);
    } else {
      if (result.formError) setError("root", { message: result.formError });
      for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
        setError(key as keyof FormValues, { message: messages[0] });
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={account ? "Edit account" : "New trading account"} />
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogBody className="flex flex-col gap-3">
            {errors.root?.message ? (
              <p className="rounded-control border border-loss/35 bg-loss-weak px-2.5 py-2 text-xs text-loss">
                {errors.root.message}
              </p>
            ) : null}

            <Field>
              <FieldLabel>Label</FieldLabel>
              <Input {...register("label", { required: "Label is required." })} placeholder="e.g. FTMO 50k Challenge" />
              <FieldError>{errors.label?.message}</FieldError>
            </Field>

            <FieldRow>
              <Field>
                <FieldLabel optional>Broker</FieldLabel>
                <Input {...register("broker")} placeholder="e.g. IC Markets" />
              </Field>
              <Field>
                <FieldLabel>Currency</FieldLabel>
                <Input
                  {...register("currency", { required: "Currency is required." })}
                  maxLength={3}
                  style={{ textTransform: "uppercase" }}
                  placeholder="USD"
                />
                <FieldError>{errors.currency?.message}</FieldError>
              </Field>
            </FieldRow>

            <FieldRow>
              <Field>
                <FieldLabel>Platform</FieldLabel>
                <Controller
                  control={control}
                  name="platform"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLATFORMS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>Account type</FieldLabel>
                <Controller
                  control={control}
                  name="accountType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field>
                <FieldLabel>Starting balance</FieldLabel>
                <NumberInput {...register("startingBalance", { required: "Required." })} unit="" />
                <FieldError>{errors.startingBalance?.message}</FieldError>
              </Field>
              <Field>
                <FieldLabel optional>Risk per trade</FieldLabel>
                <NumberInput {...register("riskPerTradePct")} unit="%" placeholder="1.0" />
                <FieldError>{errors.riskPerTradePct?.message}</FieldError>
              </Field>
            </FieldRow>

            {/* Prop-firm challenge rules. Leave all blank for a normal account;
                set any of them and the dashboard shows a challenge panel. */}
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <div>
                <p className="text-xs font-medium text-ink">Challenge rules</p>
                <p className="text-2xs text-ink-3">
                  For a prop-firm evaluation. Percentages are of the starting balance; leave blank to ignore.
                </p>
              </div>
              <FieldRow>
                <Field>
                  <FieldLabel optional>Daily loss limit</FieldLabel>
                  <NumberInput {...register("dailyLossLimitPct")} unit="%" placeholder="5" />
                  <FieldError>{errors.dailyLossLimitPct?.message}</FieldError>
                </Field>
                <Field>
                  <FieldLabel optional>Profit target</FieldLabel>
                  <NumberInput {...register("profitTargetPct")} unit="%" placeholder="10" />
                  <FieldError>{errors.profitTargetPct?.message}</FieldError>
                </Field>
              </FieldRow>
              <FieldRow>
                <Field>
                  <FieldLabel optional>Max drawdown</FieldLabel>
                  <NumberInput {...register("maxDrawdownPct")} unit="%" placeholder="10" />
                  <FieldError>{errors.maxDrawdownPct?.message}</FieldError>
                </Field>
                <Field>
                  <FieldLabel>Drawdown measured from</FieldLabel>
                  <Controller
                    control={control}
                    name="drawdownMode"
                    render={({ field }) => (
                      <Segmented value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                        <SegmentedItem value="STATIC">Starting balance</SegmentedItem>
                        <SegmentedItem value="TRAILING">Highest balance</SegmentedItem>
                      </Segmented>
                    )}
                  />
                </Field>
              </FieldRow>
              <FieldRow>
                <Field>
                  <FieldLabel optional>Minimum trading days</FieldLabel>
                  <NumberInput {...register("minTradingDays")} unit="days" placeholder="4" inputMode="numeric" />
                  <FieldError>{errors.minTradingDays?.message}</FieldError>
                </Field>
                <div aria-hidden />
              </FieldRow>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {account ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
