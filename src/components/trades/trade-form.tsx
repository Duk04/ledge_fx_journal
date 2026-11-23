"use client";

/**
 * The shared create/edit trade form. Optimised for speed of entry — a
 * journal nobody fills in is worthless — with a live preview computed
 * client-side (the same `computeRTrade` / `computeTrade` the server uses, so
 * what you see while typing is exactly what gets stored).
 *
 * Two shapes, chosen by the trade's `entryMode` (docs/TRADES.md, "R-mode
 * trades"): a new trade is logged in R — risk, planned R:R, outcome — with no
 * prices; an existing PRICE trade keeps its price fields and the geometry
 * warnings that inform without blocking (see docs/TRADES.md for why a bad
 * stop/target isn't a hard error here).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@/lib/cn";
import {
  Button,
  Panel,
  PanelBody,
  PanelHeader,
  Input,
  NumberInput,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Segmented,
  SegmentedItem,
  Combobox,
  instrumentOptions,
  Textarea,
  Kbd,
  useModKey,
} from "@/components/ui";

import { useOnlineStatus } from "@/components/pwa/use-online-status";

import { buildRTradeFormSchema, buildTradeFormSchema } from "@/lib/schemas/trade";
import type { InstrumentOption, TagOption } from "@/lib/queries/trades";
import {
  LAST_RISK_KEY,
  LAST_SYMBOL_KEY,
  defaultFormValues,
  outcomeFor,
  resultForOutcome,
  type ROutcome,
  type TradeFormInput,
} from "./trade-form-values";
import { PreviewStrip, buildPreview, buildRPreview, buildWarnings } from "./trade-preview";
import { PendingScreenshots, type PendingScreenshot } from "./pending-screenshots";
import { useTradeSubmit } from "./use-trade-submit";
import { RESPONSIVE_HEIGHT, TradeFormAdvanced, TradeFormPricePlan, TradeFormRPlan } from "./trade-form-sections";

export function TradeForm({
  mode,
  uploadsEnabled = true,
  accountId,
  tradeId,
  instruments,
  tags,
  currency,
  defaults,
  fillsLocked = false,
  playbooks = [],
}: {
  mode: "create" | "edit";
  /** False where uploads have nowhere durable to go (lib/storage.ts
   * uploadsAvailable); the Screenshots panel then says so instead of
   * offering a drop zone. */
  uploadsEnabled?: boolean;
  accountId: string;
  tradeId?: string;
  instruments: InstrumentOption[];
  tags: TagOption[];
  currency: string;
  defaults?: Partial<TradeFormInput>;
  /** The trade has several fills: its prices, size, times and status come
   * from them (lib/metrics/fills.ts), so those fields are read-only here. */
  fillsLocked?: boolean;
  /** The user's active playbooks, for the optional "taken as" picker. */
  playbooks?: { id: string; name: string }[];
}) {
  const t = useTranslations("trades.form");
  const tEnum = useTranslations("enums");
  const tAttachments = useTranslations("trades.attachments");
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const online = useOnlineStatus();
  // The save hint said "⌘⏎" on Windows too, where it is Ctrl+Enter.
  const modKey = useModKey();

  const validSymbols = React.useMemo(() => new Set(instruments.map((i) => i.symbol)), [instruments]);
  const symbolOptions = React.useMemo(() => instrumentOptions(instruments), [instruments]);
  // New trades are logged in R (risk, planned R:R, result); a trade recorded
  // with prices keeps its price form. The mode never changes on a trade.
  const rMode = (defaults?.entryMode ?? "R_MULTIPLE") === "R_MULTIPLE";
  const schema = React.useMemo(
    () => (rMode ? buildRTradeFormSchema(validSymbols) : buildTradeFormSchema(validSymbols)),
    [rMode, validSymbols],
  );
  // Which outcome button is lit. Kept as state rather than derived from the
  // R field so that "Custom" stays selected while its value happens to be -1.
  const [outcome, setOutcome] = React.useState<ROutcome | "">(() =>
    outcomeFor(defaults?.resultR ?? "", defaults?.plannedRR ?? ""),
  );

  const form = useForm<TradeFormInput>({
    // The schema's fields go through `z.preprocess` (see schemas/trade.ts)
    // to coerce strings into numbers/dates, which makes their *input* type
    // `unknown` as far as zod's inference is concerned — that's correct
    // (any raw form value is accepted, then coerced), but it means
    // `zodResolver`'s inferred type doesn't structurally match this form's
    // plain string-valued `TradeFormInput`. Both sides are right about the
    // runtime behaviour; only the static shapes disagree, hence the cast.
    resolver: zodResolver(schema) as unknown as Resolver<TradeFormInput>,
    defaultValues: defaultFormValues(defaults),
    mode: "onBlur",
  });

  // Screenshots picked before the trade exists; uploaded once it does (see
  // PendingScreenshots for why they wait). Create mode only — a saved
  // trade's edit page has the full uploader beside this form.
  const [screenshots, setScreenshots] = React.useState<PendingScreenshot[]>([]);

  // Remember the last symbol and risk for next time — a journal you have to
  // re-type into every time is a journal you stop using.
  React.useEffect(() => {
    if (mode !== "create") return;
    try {
      const lastSymbol = window.localStorage.getItem(LAST_SYMBOL_KEY);
      const lastRisk = window.localStorage.getItem(LAST_RISK_KEY);
      if (lastSymbol) form.setValue("symbol", lastSymbol);
      // Most traders risk the same amount every time.
      if (lastRisk && rMode) form.setValue("plannedRisk", lastRisk);
    } catch {
      /* localStorage unavailable (private mode, blocked) — fine, just skip prefill */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only prefill for a new trade. The only missing dep is `form`, which react-hook-form guarantees is stable; adding it would re-run the prefill and overwrite what the user has typed.
  }, [mode]);

  // `useWatch` rather than `form.watch()`: it's a real hook React (and its
  // compiler) can reason about, where `.watch()` is an opaque function call
  // on the form instance — see the react-hooks/incompatible-library rule.
  const watched = useWatch({ control: form.control });
  const status = watched.status;
  const instrument = instruments.find((i) => i.symbol === watched.symbol?.toUpperCase());

  const preview = React.useMemo(
    () => (rMode ? buildRPreview(watched, currency) : buildPreview(watched, instrument, currency)),
    [rMode, watched, instrument, currency],
  );
  const geometryWarnings = React.useMemo(
    () => (rMode ? [] : buildWarnings(watched, instrument)),
    [rMode, watched, instrument],
  );

  function pickOutcome(next: ROutcome) {
    setOutcome(next);
    const r = resultForOutcome(next, form.getValues("plannedRR"));
    if (r !== undefined) {
      form.setValue("resultR", r, { shouldValidate: form.formState.isSubmitted });
    } else {
      // Custom, or a win with no planned R:R to read it from: type it in.
      form.setFocus("resultR");
    }
  }

  const { onSubmit, uploading } = useTradeSubmit({ mode, accountId, tradeId, rMode, form, screenshots });

  function handleKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter") return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.tagName === "TEXTAREA") return; // Enter should insert a newline there
    if (target.tagName === "INPUT") e.preventDefault(); // never submit by accident from a price/volume field
  }

  const errors = form.formState.errors;

  return (
    <form
      ref={formRef}
      onSubmit={form.handleSubmit(onSubmit)}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-4"
    >
      <Panel>
        <PanelBody className="flex flex-col gap-4">
          {fillsLocked ? (
            <p className="rounded-control border border-line bg-panel-sunken px-3 py-2 text-xs text-ink-2">
              {t("fillsLocked")}
            </p>
          ) : null}
          <fieldset disabled={fillsLocked} className="contents">
            <FieldRow>
              <Field>
                <FieldLabel>{t("symbol")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="symbol"
                  render={({ field }) => (
                    <Combobox
                      options={symbolOptions}
                      value={field.value}
                      onValueChange={field.onChange}
                      aria-invalid={!!errors.symbol}
                      className={RESPONSIVE_HEIGHT}
                      placeholder={t("chooseSymbol")}
                    />
                  )}
                />
                <FieldError>{errors.symbol?.message}</FieldError>
              </Field>

              <Field>
                <FieldLabel>{t("direction")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="direction"
                  render={({ field }) => (
                    <Segmented value={field.value} onValueChange={(v) => v && field.onChange(v)} className="w-full">
                      <SegmentedItem value="LONG" className="flex-1">
                        {tEnum("direction.LONG")}
                      </SegmentedItem>
                      <SegmentedItem value="SHORT" className="flex-1">
                        {tEnum("direction.SHORT")}
                      </SegmentedItem>
                    </Segmented>
                  )}
                />
              </Field>
            </FieldRow>

            <Field>
              <FieldLabel>{t("openedAt")}</FieldLabel>
              <Input
                type="datetime-local"
                className={cn(RESPONSIVE_HEIGHT, "max-w-xs")}
                aria-invalid={!!errors.openedAt}
                {...form.register("openedAt")}
              />
              <FieldError>{errors.openedAt?.message}</FieldError>
            </Field>
          </fieldset>

          {rMode ? (
            <TradeFormRPlan form={form} currency={currency} winSelected={outcome === "WIN"} />
          ) : (
            <TradeFormPricePlan form={form} fillsLocked={fillsLocked} geometryWarnings={geometryWarnings} />
          )}

          <fieldset disabled={fillsLocked} className="contents">
            <Field>
              <FieldLabel>{t("status")}</FieldLabel>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Segmented value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                    <SegmentedItem value="OPEN">{tEnum("status.OPEN")}</SegmentedItem>
                    <SegmentedItem value="CLOSED">{tEnum("status.CLOSED")}</SegmentedItem>
                    <SegmentedItem value="CANCELLED">{tEnum("status.CANCELLED")}</SegmentedItem>
                  </Segmented>
                )}
              />
            </Field>

            {/* The order a trade happens in: what and which way, when and how big,
                the plan, what became of it — and the exit only once there is one. An
                open trade used to show two "optional" exit fields that only invited a
                half-filled close. */}
            {status === "CLOSED" && rMode ? (
              <>
                <Field>
                  <FieldLabel>{t("outcome")}</FieldLabel>
                  <Segmented value={outcome} onValueChange={(v) => v && pickOutcome(v as ROutcome)}>
                    <SegmentedItem value="WIN">{t("outcomeWin")}</SegmentedItem>
                    <SegmentedItem value="LOSS">{t("outcomeLoss")}</SegmentedItem>
                    <SegmentedItem value="BREAKEVEN">{t("outcomeBreakeven")}</SegmentedItem>
                    <SegmentedItem value="CUSTOM">{t("outcomeCustom")}</SegmentedItem>
                  </Segmented>
                </Field>
                <FieldRow>
                  <Field>
                    <FieldLabel>{t("resultR")}</FieldLabel>
                    <NumberInput
                      className={RESPONSIVE_HEIGHT}
                      unit="R"
                      placeholder="2.5"
                      aria-invalid={!!errors.resultR}
                      {...form.register("resultR", {
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                          setOutcome(outcomeFor(e.target.value, form.getValues("plannedRR")) || "CUSTOM"),
                      })}
                    />
                    <FieldHint>{t("resultRHint")}</FieldHint>
                    <FieldError>{errors.resultR?.message}</FieldError>
                  </Field>

                  <Field>
                    <FieldLabel>{t("closedAt")}</FieldLabel>
                    <Input
                      type="datetime-local"
                      className={RESPONSIVE_HEIGHT}
                      aria-invalid={!!errors.closedAt}
                      {...form.register("closedAt")}
                    />
                    <FieldError>{errors.closedAt?.message}</FieldError>
                  </Field>
                </FieldRow>
              </>
            ) : status === "CLOSED" ? (
              <FieldRow>
                <Field>
                  <FieldLabel>{t("exitPrice")}</FieldLabel>
                  <NumberInput
                    className={RESPONSIVE_HEIGHT}
                    placeholder="0.00000"
                    aria-invalid={!!errors.exitPrice}
                    {...form.register("exitPrice")}
                  />
                  <FieldError>{errors.exitPrice?.message}</FieldError>
                </Field>

                <Field>
                  <FieldLabel>{t("closedAt")}</FieldLabel>
                  <Input
                    type="datetime-local"
                    className={RESPONSIVE_HEIGHT}
                    aria-invalid={!!errors.closedAt}
                    {...form.register("closedAt")}
                  />
                  <FieldError>{errors.closedAt?.message}</FieldError>
                </Field>
              </FieldRow>
            ) : null}
          </fieldset>

          {/* The one free-text field, in sight rather than folded away: with
              the screenshot below it, it is what makes the row a journal
              entry instead of a number. */}
          <Field>
            <FieldLabel optional>{t("notes")}</FieldLabel>
            <Textarea rows={3} placeholder={t("notesPlaceholder")} {...form.register("notes")} />
            <FieldError>{errors.notes?.message}</FieldError>
          </Field>
        </PanelBody>
      </Panel>

      <PreviewStrip preview={preview} mode={rMode ? "R_MULTIPLE" : "PRICE"} />

      {/* Above the collapsed "Details" panel, not after it: pasting the chart
          is the most common thing done here after the prices. Shown even
          where uploads are off (no S3 on a serverless host), with the reason —
          hiding it left people looking for a feature that seemed missing. */}
      {mode === "create" ? (
        <Panel>
          <PanelHeader title={t("screenshotsTitle")} caption={t("screenshotsCaption")} />
          <PanelBody>
            {uploadsEnabled ? (
              <PendingScreenshots
                value={screenshots}
                onChange={setScreenshots}
                disabled={form.formState.isSubmitting}
              />
            ) : (
              <p className="rounded-control border border-line bg-panel-sunken px-3 py-2 text-xs text-ink-3">
                {tAttachments("uploadsUnavailable")}
              </p>
            )}
          </PanelBody>
        </Panel>
      ) : null}

      <TradeFormAdvanced form={form} currency={currency} rMode={rMode} tags={tags} playbooks={playbooks} />

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="default" onClick={() => router.back()}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={form.formState.isSubmitting || !online}
          title={online ? undefined : t("offlineSubmitTitle")}
        >
          {uploading
            ? t("uploadingScreenshots", { done: String(uploading.done + 1), total: String(uploading.total) })
            : form.formState.isSubmitting
              ? t("saving")
              : mode === "create"
                ? t("logTrade")
                : t("saveChanges")}
          <Kbd className="ml-1 hidden md:inline-flex">{modKey}⏎</Kbd>
        </Button>
      </div>
    </form>
  );
}
