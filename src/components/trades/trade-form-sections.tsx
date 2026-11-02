"use client";

/**
 * Pieces of the trade form (trade-form.tsx), split out so the form reads as
 * its shape: the plan in R or in prices — the two modes share nothing but
 * their place on the page — and the collapsible "Discipline & notes" panel.
 * Each takes the form instance and registers its own fields.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Controller, type UseFormReturn } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  NumberInput,
  PanelBody,
  PanelHeader,
  Panel,
  Segmented,
  SegmentedItem,
  Textarea,
} from "@/components/ui";
import type { TradeFormInput } from "./trade-form-values";

export const RESPONSIVE_HEIGHT = "h-control-lg sm:h-control";

type Form = UseFormReturn<TradeFormInput>;

/** An R-mode trade's plan: the money at risk and the planned R:R. */
export function TradeFormRPlan({
  form,
  currency,
  winSelected,
}: {
  form: Form;
  currency: string;
  winSelected: boolean;
}) {
  const t = useTranslations("trades.form");
  const errors = form.formState.errors;
  return (
    <>
      <FieldRow>
        <Field>
          <FieldLabel>{t("plannedRisk")}</FieldLabel>
          <NumberInput
            className={RESPONSIVE_HEIGHT}
            unit={currency}
            placeholder="100"
            aria-invalid={!!errors.plannedRisk}
            {...form.register("plannedRisk")}
          />
          <FieldHint>{t("plannedRiskHint")}</FieldHint>
          <FieldError>{errors.plannedRisk?.message}</FieldError>
        </Field>

        <Field>
          <FieldLabel optional>{t("plannedRR")}</FieldLabel>
          <div className="flex items-center gap-2">
            <span className="mono shrink-0 text-sm text-ink-3" aria-hidden>
              1 :
            </span>
            <NumberInput
              className={RESPONSIVE_HEIGHT}
              placeholder="2.5"
              aria-invalid={!!errors.plannedRR}
              {...form.register("plannedRR", {
                // A win is "hit the plan": keep it in step while the
                // plan is still being typed.
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  if (winSelected) form.setValue("resultR", e.target.value);
                },
              })}
            />
          </div>
          <FieldHint>{t("plannedRRHint")}</FieldHint>
          <FieldError>{errors.plannedRR?.message}</FieldError>
        </Field>
      </FieldRow>
    </>
  );
}

/** A price-mode trade's plan: size, entry, stop, target — with the geometry
 * warnings that inform without blocking (docs/TRADES.md). */
export function TradeFormPricePlan({
  form,
  fillsLocked,
  geometryWarnings,
}: {
  form: Form;
  fillsLocked: boolean;
  geometryWarnings: { code: string; message: string }[];
}) {
  const t = useTranslations("trades.form");
  const errors = form.formState.errors;
  return (
    <>
      <fieldset disabled={fillsLocked} className="contents">
        <FieldRow>
          <Field>
            <FieldLabel>{t("volumeLots")}</FieldLabel>
            <NumberInput
              className={RESPONSIVE_HEIGHT}
              unit={t("lotsUnit")}
              placeholder="1.00"
              aria-invalid={!!errors.volumeLots}
              {...form.register("volumeLots")}
            />
            <FieldError>{errors.volumeLots?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel>{t("entryPrice")}</FieldLabel>
            <NumberInput
              className={RESPONSIVE_HEIGHT}
              placeholder="0.00000"
              aria-invalid={!!errors.entryPrice}
              {...form.register("entryPrice")}
            />
            <FieldError>{errors.entryPrice?.message}</FieldError>
          </Field>
        </FieldRow>
      </fieldset>

      <FieldRow>
        <Field>
          <FieldLabel optional>{t("stopLoss")}</FieldLabel>
          <NumberInput
            className={RESPONSIVE_HEIGHT}
            placeholder="0.00000"
            aria-invalid={!!errors.stopLoss}
            {...form.register("stopLoss")}
          />
          <FieldError>{errors.stopLoss?.message}</FieldError>
        </Field>

        <Field>
          <FieldLabel optional>{t("takeProfit")}</FieldLabel>
          <NumberInput
            className={RESPONSIVE_HEIGHT}
            placeholder="0.00000"
            aria-invalid={!!errors.takeProfit}
            {...form.register("takeProfit")}
          />
          <FieldError>{errors.takeProfit?.message}</FieldError>
        </Field>
      </FieldRow>

      <FieldRow>
        <Field>
          <FieldLabel optional>{t("initialStop")}</FieldLabel>
          <NumberInput
            className={RESPONSIVE_HEIGHT}
            placeholder={t("initialStopPlaceholder")}
            aria-invalid={!!errors.initialStopLoss}
            {...form.register("initialStopLoss")}
          />
          <FieldHint>{t("initialStopHint")}</FieldHint>
          <FieldError>{errors.initialStopLoss?.message}</FieldError>
        </Field>
        {/* Keeps the field half-width, aligned with Stop loss above. */}
        <div aria-hidden />
      </FieldRow>

      {geometryWarnings.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-control border border-warn/30 bg-warn-weak px-3 py-2 text-xs text-warn">
          {geometryWarnings.map((w) => (
            <p key={w.code}>{w.message}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Fields rendered inside the collapsible "Discipline & notes" panel. */
const ADVANCED_FIELDS = [
  "maePrice",
  "mfePrice",
  "commission",
  "swap",
  "followedPlan",
  "emotion",
  "confidence",
  "notes",
] as const satisfies readonly (keyof TradeFormInput)[];

/** MAE/MFE, costs and the discipline fields, folded away by default. */
export function TradeFormAdvanced({ form, currency, rMode }: { form: Form; currency: string; rMode: boolean }) {
  const t = useTranslations("trades.form");
  const errors = form.formState.errors;
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const advancedId = React.useId();

  // These fields live in the collapsible panel. A collapsed panel unmounts
  // them, so a validation or server error on one of them would otherwise be
  // invisible — the toast says "check the highlighted fields" and nothing is
  // highlighted. The panel is therefore open whenever one of them has an
  // error, derived rather than synced through an effect.
  const advancedHasError = ADVANCED_FIELDS.some((f) => errors[f]);
  const panelOpen = advancedOpen || advancedHasError;

  return (
    <Panel>
      {/* A real disclosure: the button sits inside the heading (a heading
            inside a button is invalid HTML), takes keyboard focus, and
            announces its state through aria-expanded. */}
      <PanelHeader className="px-0">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls={advancedId}
            onClick={() => setAdvancedOpen(!panelOpen)}
            className="flex min-h-10 w-full items-center justify-between gap-3 px-3 text-left select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-sm font-semibold text-ink">{t("advancedTitle")}</span>
              <span className="truncate text-xs font-normal text-ink-3">{t("advancedSubtitle")}</span>
            </span>
            <ChevronDown
              aria-hidden
              className={cn("size-4 shrink-0 text-ink-3 transition-transform", panelOpen && "rotate-180")}
            />
          </button>
        </h2>
      </PanelHeader>
      {panelOpen ? (
        <PanelBody id={advancedId} className="flex flex-col gap-4">
          {/* MAE / MFE are prices; an R-mode trade has none to compare. */}
          {rMode ? null : (
            <FieldRow>
              <Field>
                <FieldLabel optional>{t("mae")}</FieldLabel>
                <NumberInput placeholder="0.00000" aria-invalid={!!errors.maePrice} {...form.register("maePrice")} />
                <FieldHint>{t("maeHint")}</FieldHint>
                <FieldError>{errors.maePrice?.message}</FieldError>
              </Field>
              <Field>
                <FieldLabel optional>{t("mfe")}</FieldLabel>
                <NumberInput placeholder="0.00000" aria-invalid={!!errors.mfePrice} {...form.register("mfePrice")} />
                <FieldHint>{t("mfeHint")}</FieldHint>
                <FieldError>{errors.mfePrice?.message}</FieldError>
              </Field>
            </FieldRow>
          )}
          <FieldRow>
            <Field>
              <FieldLabel optional>{t("commission")}</FieldLabel>
              <NumberInput unit={currency} placeholder="0.00" {...form.register("commission")} />
              <FieldHint>{t("commissionHint")}</FieldHint>
            </Field>
            <Field>
              <FieldLabel optional>{t("swap")}</FieldLabel>
              <NumberInput unit={currency} placeholder="0.00" {...form.register("swap")} />
            </Field>
          </FieldRow>

          <Field>
            <FieldLabel optional>{t("followedPlan")}</FieldLabel>
            <Controller
              control={form.control}
              name="followedPlan"
              render={({ field }) => (
                <Segmented value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
                  <SegmentedItem value="">{t("unsure")}</SegmentedItem>
                  <SegmentedItem value="yes">{t("yes")}</SegmentedItem>
                  <SegmentedItem value="no">{t("no")}</SegmentedItem>
                </Segmented>
              )}
            />
          </Field>

          <FieldRow>
            <Field>
              <FieldLabel optional>{t("emotion")}</FieldLabel>
              <Controller
                control={form.control}
                name="emotion"
                render={({ field }) => (
                  <Segmented value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
                    {["1", "2", "3", "4", "5"].map((n) => (
                      <SegmentedItem key={n} value={n}>
                        {n}
                      </SegmentedItem>
                    ))}
                  </Segmented>
                )}
              />
            </Field>
            <Field>
              <FieldLabel optional>{t("confidence")}</FieldLabel>
              <Controller
                control={form.control}
                name="confidence"
                render={({ field }) => (
                  <Segmented value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
                    {["1", "2", "3", "4", "5"].map((n) => (
                      <SegmentedItem key={n} value={n}>
                        {n}
                      </SegmentedItem>
                    ))}
                  </Segmented>
                )}
              />
            </Field>
          </FieldRow>

          <Field>
            <FieldLabel optional>{t("notes")}</FieldLabel>
            <Textarea rows={5} placeholder={t("notesPlaceholder")} {...form.register("notes")} />
            <FieldError>{errors.notes?.message}</FieldError>
          </Field>
        </PanelBody>
      ) : null}
    </Panel>
  );
}
