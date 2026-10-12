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

import { TagChip } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useOnlineStatus } from "@/components/pwa/use-online-status";

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

const RESPONSIVE_HEIGHT = "h-control-lg sm:h-control";

/** Fields rendered inside the collapsible "Discipline & notes" panel. */
const ADVANCED_FIELDS = [
  "commission",
  "swap",
  "followedPlan",
  "emotion",
  "confidence",
  "notes",
] as const satisfies readonly (keyof TradeFormInput)[];

export function TradeForm({
  mode,
  accountId,
  tradeId,
  instruments,
  tags,
  currency,
  defaults,
  fillsLocked = false,
}: {
  mode: "create" | "edit";
  accountId: string;
  tradeId?: string;
  instruments: InstrumentOption[];
  tags: TagOption[];
  currency: string;
  defaults?: Partial<TradeFormInput>;
  /** The trade has several fills: its prices, size, times and status come
   * from them (lib/metrics/fills.ts), so those fields are read-only here. */
  fillsLocked?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const advancedId = React.useId();
  const online = useOnlineStatus();

  const validSymbols = React.useMemo(() => new Set(instruments.map((i) => i.symbol)), [instruments]);
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
        title: "You're offline",
        description: "This trade can't be saved until you're back online. Nothing you typed is lost.",
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
      toast({ title: mode === "create" ? "Trade logged" : "Trade updated" });
      router.push(`/trades/${result.id}`);
      return;
    }

    if (result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof TradeFormInput, { type: "server", message: messages[0] });
      }
    }
    toast({
      title: "Couldn't save trade",
      description: result.formError ?? "Check the highlighted fields.",
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
            <p className="rounded-[var(--radius-control)] border border-line bg-panel-sunken px-3 py-2 text-xs text-ink-2">
              This trade was scaled in or partly closed. Its symbol, prices, size, times and status come from its fills
              — change those in the Fills panel on the trade page.
            </p>
          ) : null}
          <fieldset disabled={fillsLocked} className="contents">
            <FieldRow>
              <Field>
                <FieldLabel>Symbol</FieldLabel>
                <Controller
                  control={form.control}
                  name="symbol"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger aria-invalid={!!errors.symbol} className={RESPONSIVE_HEIGHT}>
                        <SelectValue placeholder="Choose a symbol" />
                      </SelectTrigger>
                      <SelectContent>
                        {instruments.map((i) => (
                          <SelectItem key={i.symbol} value={i.symbol}>
                            {i.symbol} — {i.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{errors.symbol?.message}</FieldError>
              </Field>

              <Field>
                <FieldLabel>Direction</FieldLabel>
                <Controller
                  control={form.control}
                  name="direction"
                  render={({ field }) => (
                    <Segmented value={field.value} onValueChange={(v) => v && field.onChange(v)} className="w-full">
                      <SegmentedItem value="LONG" className="flex-1">
                        Long
                      </SegmentedItem>
                      <SegmentedItem value="SHORT" className="flex-1">
                        Short
                      </SegmentedItem>
                    </Segmented>
                  )}
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field>
                <FieldLabel>Volume (lots)</FieldLabel>
                <NumberInput
                  className={RESPONSIVE_HEIGHT}
                  unit="lots"
                  placeholder="1.00"
                  aria-invalid={!!errors.volumeLots}
                  {...form.register("volumeLots")}
                />
                <FieldError>{errors.volumeLots?.message}</FieldError>
              </Field>

              <Field>
                <FieldLabel>Entry price</FieldLabel>
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
              <FieldLabel optional>Stop loss</FieldLabel>
              <NumberInput
                className={RESPONSIVE_HEIGHT}
                placeholder="0.00000"
                aria-invalid={!!errors.stopLoss}
                {...form.register("stopLoss")}
              />
              <FieldError>{errors.stopLoss?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel optional>Take profit</FieldLabel>
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
              <FieldLabel optional>Initial stop</FieldLabel>
              <NumberInput
                className={RESPONSIVE_HEIGHT}
                placeholder="same as stop loss"
                aria-invalid={!!errors.initialStopLoss}
                {...form.register("initialStopLoss")}
              />
              <FieldHint>
                Where the stop was at entry. R is measured from it, so trailing your stop doesn&rsquo;t change R.
              </FieldHint>
              <FieldError>{errors.initialStopLoss?.message}</FieldError>
            </Field>
            {/* Keeps the field half-width, aligned with Stop loss above. */}
            <div aria-hidden />
          </FieldRow>

          {geometryWarnings.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-warn/30 bg-warn-weak px-3 py-2 text-xs text-warn">
              {geometryWarnings.map((w) => (
                <p key={w.code}>{w.message}</p>
              ))}
            </div>
          ) : null}

          <fieldset disabled={fillsLocked} className="contents">
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Segmented value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                    <SegmentedItem value="OPEN">Open</SegmentedItem>
                    <SegmentedItem value="CLOSED">Closed</SegmentedItem>
                    <SegmentedItem value="CANCELLED">Cancelled</SegmentedItem>
                  </Segmented>
                )}
              />
            </Field>

            <FieldRow>
              <Field>
                <FieldLabel optional={status !== "CLOSED"}>Exit price</FieldLabel>
                <NumberInput
                  className={RESPONSIVE_HEIGHT}
                  placeholder="0.00000"
                  aria-invalid={!!errors.exitPrice}
                  {...form.register("exitPrice")}
                />
                <FieldError>{errors.exitPrice?.message}</FieldError>
              </Field>

              <Field>
                <FieldLabel optional={status !== "CLOSED"}>Closed at</FieldLabel>
                <Input
                  type="datetime-local"
                  className={RESPONSIVE_HEIGHT}
                  aria-invalid={!!errors.closedAt}
                  {...form.register("closedAt")}
                />
                <FieldError>{errors.closedAt?.message}</FieldError>
              </Field>
            </FieldRow>

            <Field>
              <FieldLabel>Opened at</FieldLabel>
              <Input
                type="datetime-local"
                className={cn(RESPONSIVE_HEIGHT, "max-w-xs")}
                aria-invalid={!!errors.openedAt}
                {...form.register("openedAt")}
              />
              <FieldError>{errors.openedAt?.message}</FieldError>
            </Field>
          </fieldset>

          <Field>
            <FieldLabel optional>Tags</FieldLabel>
            <Controller
              control={form.control}
              name="tagIds"
              render={({ field }) => (
                <FieldGroup className="flex flex-wrap gap-1.5">
                  {tags.length === 0 ? <span className="text-xs text-ink-3">No tags yet.</span> : null}
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
                <span className="truncate text-sm font-semibold text-ink">Discipline &amp; notes</span>
                <span className="truncate text-xs font-normal text-ink-3">
                  Optional — costs, mindset, and a write-up
                </span>
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
                <FieldLabel optional>Commission</FieldLabel>
                <NumberInput unit={currency} placeholder="0.00" {...form.register("commission")} />
                <FieldHint>Positive = a cost. A rebate can be entered as negative.</FieldHint>
              </Field>
              <Field>
                <FieldLabel optional>Swap</FieldLabel>
                <NumberInput unit={currency} placeholder="0.00" {...form.register("swap")} />
              </Field>
            </FieldRow>

            <Field>
              <FieldLabel optional>Followed the plan?</FieldLabel>
              <Controller
                control={form.control}
                name="followedPlan"
                render={({ field }) => (
                  <Segmented value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
                    <SegmentedItem value="">Unsure</SegmentedItem>
                    <SegmentedItem value="yes">Yes</SegmentedItem>
                    <SegmentedItem value="no">No</SegmentedItem>
                  </Segmented>
                )}
              />
            </Field>

            <FieldRow>
              <Field>
                <FieldLabel optional>Emotion (1–5)</FieldLabel>
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
                <FieldLabel optional>Confidence (1–5)</FieldLabel>
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
              <FieldLabel optional>Notes</FieldLabel>
              <Textarea
                rows={5}
                placeholder="What was the setup? What would you do differently?"
                {...form.register("notes")}
              />
              <FieldError>{errors.notes?.message}</FieldError>
            </Field>
          </PanelBody>
        ) : null}
      </Panel>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="default" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={form.formState.isSubmitting || !online}
          title={online ? undefined : "You're offline — this can't be saved until you reconnect."}
        >
          {form.formState.isSubmitting ? "Saving…" : mode === "create" ? "Log trade" : "Save changes"}
          <kbd className="ml-1 hidden rounded-[3px] bg-black/15 px-1 text-2xs font-normal md:inline">⌘⏎</kbd>
        </Button>
      </div>
    </form>
  );
}
