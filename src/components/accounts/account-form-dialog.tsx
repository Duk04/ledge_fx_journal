"use client";

import { Controller, useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
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

// Labels are message keys resolved at render: platforms via the shared
// `enums.platform`, account types via `accounts.form.accountTypeOption`
// because this picker says "Prop firm" where the shared enum says "Prop".
const PLATFORMS: FormValues["platform"][] = ["MT5", "MT4", "CTRADER", "OTHER"];

const ACCOUNT_TYPES: FormValues["accountType"][] = ["DEMO", "LIVE", "PROP"];

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
  const t = useTranslations("accounts.form");
  const tEnum = useTranslations("enums");
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
      toast({ title: account ? t("toastUpdated") : t("toastCreated") });
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
        <DialogHeader title={account ? t("titleEdit") : t("titleNew")} />
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogBody className="flex flex-col gap-3">
            {errors.root?.message ? (
              <p className="rounded-control border border-loss/35 bg-loss-weak px-2.5 py-2 text-xs text-loss">
                {errors.root.message}
              </p>
            ) : null}

            <Field>
              <FieldLabel>{t("label")}</FieldLabel>
              <Input {...register("label", { required: t("labelRequired") })} placeholder={t("labelPlaceholder")} />
              <FieldError>{errors.label?.message}</FieldError>
            </Field>

            <FieldRow>
              <Field>
                <FieldLabel optional>{t("broker")}</FieldLabel>
                <Input {...register("broker")} placeholder={t("brokerPlaceholder")} />
              </Field>
              <Field>
                <FieldLabel>{t("currency")}</FieldLabel>
                <Input
                  {...register("currency", { required: t("currencyRequired") })}
                  maxLength={3}
                  style={{ textTransform: "uppercase" }}
                  placeholder="USD"
                />
                <FieldError>{errors.currency?.message}</FieldError>
              </Field>
            </FieldRow>

            <FieldRow>
              <Field>
                <FieldLabel>{t("platform")}</FieldLabel>
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
                          <SelectItem key={p} value={p}>
                            {tEnum(`platform.${p}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>{t("accountType")}</FieldLabel>
                <Controller
                  control={control}
                  name="accountType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`accountTypeOption.${type}`)}
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
                <FieldLabel>{t("startingBalance")}</FieldLabel>
                <NumberInput {...register("startingBalance", { required: t("required") })} unit="" />
                <FieldError>{errors.startingBalance?.message}</FieldError>
              </Field>
              <Field>
                <FieldLabel optional>{t("riskPerTrade")}</FieldLabel>
                <NumberInput {...register("riskPerTradePct")} unit="%" placeholder="1.0" />
                <FieldError>{errors.riskPerTradePct?.message}</FieldError>
              </Field>
            </FieldRow>

            {/* Prop-firm challenge rules. Leave all blank for a normal account;
                set any of them and the dashboard shows a challenge panel. */}
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <div>
                <p className="text-xs font-medium text-ink">{t("challengeRules")}</p>
                <p className="text-2xs text-ink-3">{t("challengeHint")}</p>
              </div>
              <FieldRow>
                <Field>
                  <FieldLabel optional>{t("dailyLossLimit")}</FieldLabel>
                  <NumberInput {...register("dailyLossLimitPct")} unit="%" placeholder="5" />
                  <FieldError>{errors.dailyLossLimitPct?.message}</FieldError>
                </Field>
                <Field>
                  <FieldLabel optional>{t("profitTarget")}</FieldLabel>
                  <NumberInput {...register("profitTargetPct")} unit="%" placeholder="10" />
                  <FieldError>{errors.profitTargetPct?.message}</FieldError>
                </Field>
              </FieldRow>
              <FieldRow>
                <Field>
                  <FieldLabel optional>{t("maxDrawdown")}</FieldLabel>
                  <NumberInput {...register("maxDrawdownPct")} unit="%" placeholder="10" />
                  <FieldError>{errors.maxDrawdownPct?.message}</FieldError>
                </Field>
                <Field>
                  <FieldLabel>{t("drawdownFrom")}</FieldLabel>
                  <Controller
                    control={control}
                    name="drawdownMode"
                    render={({ field }) => (
                      <Segmented value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                        <SegmentedItem value="STATIC">{t("drawdownStatic")}</SegmentedItem>
                        <SegmentedItem value="TRAILING">{t("drawdownTrailing")}</SegmentedItem>
                      </Segmented>
                    )}
                  />
                </Field>
              </FieldRow>
              <FieldRow>
                <Field>
                  <FieldLabel optional>{t("minTradingDays")}</FieldLabel>
                  <NumberInput
                    {...register("minTradingDays")}
                    unit={t("daysUnit")}
                    placeholder="4"
                    inputMode="numeric"
                  />
                  <FieldError>{errors.minTradingDays?.message}</FieldError>
                </Field>
                <div aria-hidden />
              </FieldRow>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {account ? t("saveChanges") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
