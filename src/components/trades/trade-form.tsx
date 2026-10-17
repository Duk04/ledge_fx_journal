"use client";

/**
 * The shared create/edit trade form. Optimised for speed of entry — a
 * journal nobody fills in is worthless — with a live preview computed
 * client-side (same `computeTrade` the server uses, so what you see while
 * typing is exactly what gets stored) and geometry warnings that inform
 * without blocking: see docs/TRADES.md for why a bad stop/target isn't a
 * hard error here.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Input, NumberInput, Textarea } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldHint, FieldLabel, FieldRow } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, instrumentOptions } from "@/components/ui/combobox";

import { TagChip } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useOnlineStatus } from "@/components/pwa/use-online-status";
import { Kbd, useModKey } from "@/components/ui/kbd";

import { buildTradeFormSchema } from "@/lib/schemas/trade";
import { createTrade, updateTrade } from "@/lib/actions/trades";
import type { InstrumentOption, TagOption } from "@/lib/queries/trades";
import {
  LAST_SYMBOL_KEY,
  LAST_VOLUME_KEY,
  buildFormData,
  defaultFormValues,
  type TradeFormInput,
} from "./trade-form-values";
import { PreviewStrip, buildPreview, buildWarnings } from "./trade-preview";
import { PendingScreenshots, type PendingScreenshot } from "./pending-screenshots";
import { uploadAttachment } from "./attachment-files";

const RESPONSIVE_HEIGHT = "h-control-lg sm:h-control";
/** Radix Select can't use "" as an item value; this stands for "no playbook". */
const NO_PLAYBOOK = "__none__";

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
   * uploadsAvailable); the Screenshots panel is then left out. */
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
  const router = useRouter();
  const { toast } = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const advancedId = React.useId();
  const online = useOnlineStatus();
  // The save hint said "⌘⏎" on Windows too, where it is Ctrl+Enter.
  const modKey = useModKey();

  const validSymbols = React.useMemo(() => new Set(instruments.map((i) => i.symbol)), [instruments]);
  const symbolOptions = React.useMemo(() => instrumentOptions(instruments), [instruments]);
  const schema = React.useMemo(() => buildTradeFormSchema(validSymbols), [validSymbols]);

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
  const [uploading, setUploading] = React.useState<{ done: number; total: number } | null>(null);

  // Remember the last symbol/volume for next time — a journal you have to
  // re-type into every time is a journal you stop using.
  React.useEffect(() => {
    if (mode !== "create") return;
    try {
      const lastSymbol = window.localStorage.getItem(LAST_SYMBOL_KEY);
      const lastVolume = window.localStorage.getItem(LAST_VOLUME_KEY);
      if (lastSymbol) form.setValue("symbol", lastSymbol);
      if (lastVolume) form.setValue("volumeLots", lastVolume);
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

  const preview = React.useMemo(() => buildPreview(watched, instrument, currency), [watched, instrument, currency]);
  const geometryWarnings = React.useMemo(() => buildWarnings(watched, instrument), [watched, instrument]);

  async function onSubmit(values: TradeFormInput) {
    // The submit button is disabled offline, but ⌘⏎ calls requestSubmit()
    // directly and that ignores a disabled button. docs/PWA.md: no offline
    // write queue, so say so instead of letting the action fail opaquely.
    if (!online) {
      toast({
        title: t("offlineTitle"),
        description: t("offlineDescription"),
        tone: "warn",
      });
      return;
    }
    const fd = buildFormData(values);
    const result = mode === "create" ? await createTrade(accountId, fd) : await updateTrade(accountId, tradeId!, fd);

    if (result.ok) {
      try {
        window.localStorage.setItem(LAST_SYMBOL_KEY, values.symbol);
        window.localStorage.setItem(LAST_VOLUME_KEY, values.volumeLots);
      } catch {
        /* ignore */
      }
      // Sequential, not parallel: a handful of chart images, and one at a
      // time keeps the progress honest and the server's memory flat. The
      // trade is already saved, so a failure here costs a re-upload on the
      // trade page, not the trade.
      let failed = 0;
      if (mode === "create" && screenshots.length) {
        for (const [i, shot] of screenshots.entries()) {
          setUploading({ done: i, total: screenshots.length });
          const up = await uploadAttachment({ tradeId: result.id, file: shot.file, kind: shot.kind });
          if (!up.ok) failed++;
        }
        setUploading(null);
      }
      if (failed) {
        toast({
          title: t("logged"),
          description: t("screenshotsFailed", { count: failed }),
          tone: "warn",
        });
      } else {
        toast({ title: mode === "create" ? t("logged") : t("updated") });
      }
      router.push(`/trades/${result.id}`);
      return;
    }

    if (result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof TradeFormInput, { type: "server", message: messages[0] });
      }
    }
    toast({
      title: t("saveFailed"),
      description: result.formError ?? t("checkFields"),
      tone: "loss",
    });
  }

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

  // These fields live in the collapsible panel. A collapsed panel unmounts
  // them, so a validation or server error on one of them would otherwise be
  // invisible — the toast says "check the highlighted fields" and nothing is
  // highlighted. The panel is therefore open whenever one of them has an
  // error, derived rather than synced through an effect.
  const advancedHasError = ADVANCED_FIELDS.some((f) => errors[f]);
  const panelOpen = advancedOpen || advancedHasError;

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
            {status === "CLOSED" ? (
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

          {playbooks.length ? (
            <Field>
              <FieldLabel optional>{t("playbook")}</FieldLabel>
              <Controller
                control={form.control}
                name="playbookId"
                render={({ field }) => (
                  <Select
                    value={field.value || NO_PLAYBOOK}
                    onValueChange={(v) => field.onChange(v === NO_PLAYBOOK ? "" : v)}
                  >
                    <SelectTrigger className={RESPONSIVE_HEIGHT}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PLAYBOOK}>{t("noPlaybook")}</SelectItem>
                      {playbooks.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldHint>{t("playbookHint")}</FieldHint>
              <FieldError>{errors.playbookId?.message}</FieldError>
            </Field>
          ) : null}

          <Field>
            <FieldLabel optional>{t("tags")}</FieldLabel>
            <Controller
              control={form.control}
              name="tagIds"
              render={({ field }) => (
                <FieldGroup className="flex flex-wrap gap-1.5">
                  {tags.length === 0 ? <span className="text-xs text-ink-3">{t("noTags")}</span> : null}
                  {tags.map((tag) => {
                    const active = field.value.includes(tag.id);
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        aria-pressed={active}
                        onClick={() =>
                          field.onChange(active ? field.value.filter((id) => id !== tag.id) : [...field.value, tag.id])
                        }
                      >
                        <TagChip
                          name={tag.name}
                          color={tag.color}
                          className={cn(!active && "opacity-45", "transition-opacity")}
                        />
                      </button>
                    );
                  })}
                </FieldGroup>
              )}
            />
          </Field>
        </PanelBody>
      </Panel>

      <PreviewStrip preview={preview} />

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

      {mode === "create" && uploadsEnabled ? (
        <Panel>
          <PanelHeader title={t("screenshotsTitle")} caption={t("screenshotsCaption")} />
          <PanelBody>
            <PendingScreenshots value={screenshots} onChange={setScreenshots} disabled={form.formState.isSubmitting} />
          </PanelBody>
        </Panel>
      ) : null}

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
