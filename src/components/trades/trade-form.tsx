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
import { Field, FieldError, FieldHint, FieldLabel, FieldRow } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Stat } from "@/components/ui/stat";
import { TagChip } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { computeTrade, validateTradeGeometry } from "@/lib/metrics";
import { formatMoney, formatPips } from "@/lib/metrics/formatters";
import type { AssetClass } from "@/lib/metrics/types";
import { buildTradeFormSchema } from "@/lib/schemas/trade";
import { createTrade, updateTrade } from "@/lib/actions/trades";
import type { InstrumentOption, TagOption } from "@/lib/queries/trades";

const LAST_SYMBOL_KEY = "ledger.lastSymbol";
const LAST_VOLUME_KEY = "ledger.lastVolume";

/** The form's raw field shape — every control is string-valued (native
 * inputs, or a Segmented's string value), matching what `parseTradeForm`
 * expects from FormData. Coercion into numbers/dates/booleans happens in
 * the zod schema, not here. */
export interface TradeFormInput {
  symbol: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED" | "CANCELLED";
  openedAt: string;
  closedAt: string;
  entryPrice: string;
  exitPrice: string;
  stopLoss: string;
  takeProfit: string;
  volumeLots: string;
  commission: string;
  swap: string;
  conversionRate: string;
  followedPlan: "" | "yes" | "no";
  emotion: string;
  confidence: string;
  notes: string;
  tagIds: string[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date -> "YYYY-MM-DDTHH:mm" in the *browser's* local time, for a
 * `datetime-local` input's value. */
function toDatetimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : toDatetimeLocal(d);
}

/** A `datetime-local` value is interpreted here (in the browser, in the
 * user's own timezone) and turned into an unambiguous UTC ISO string before
 * it ever reaches the server — the server has no way to know what timezone
 * a bare "2026-06-01T09:00" was meant in, and guessing wrong silently
 * misfiles a trade's session. */
function datetimeLocalToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function defaultFormValues(defaults?: Partial<TradeFormInput>): TradeFormInput {
  return {
    symbol: "",
    direction: "LONG",
    status: "OPEN",
    openedAt: toDatetimeLocal(new Date()),
    closedAt: "",
    entryPrice: "",
    exitPrice: "",
    stopLoss: "",
    takeProfit: "",
    volumeLots: "",
    commission: "",
    swap: "",
    conversionRate: "",
    followedPlan: "",
    emotion: "",
    confidence: "",
    notes: "",
    tagIds: [],
    ...defaults,
  };
}

function buildFormData(values: TradeFormInput): FormData {
  const fd = new FormData();
  fd.set("symbol", values.symbol);
  fd.set("direction", values.direction);
  fd.set("status", values.status);
  fd.set("openedAt", datetimeLocalToIso(values.openedAt));
  if (values.closedAt) fd.set("closedAt", datetimeLocalToIso(values.closedAt));
  fd.set("entryPrice", values.entryPrice);
  if (values.exitPrice) fd.set("exitPrice", values.exitPrice);
  if (values.stopLoss) fd.set("stopLoss", values.stopLoss);
  if (values.takeProfit) fd.set("takeProfit", values.takeProfit);
  fd.set("volumeLots", values.volumeLots);
  if (values.commission) fd.set("commission", values.commission);
  if (values.swap) fd.set("swap", values.swap);
  if (values.conversionRate) fd.set("conversionRate", values.conversionRate);
  if (values.followedPlan) fd.set("followedPlan", values.followedPlan);
  if (values.emotion) fd.set("emotion", values.emotion);
  if (values.confidence) fd.set("confidence", values.confidence);
  if (values.notes) fd.set("notes", values.notes);
  values.tagIds.forEach((id) => fd.append("tagIds", id));
  return fd;
}

/** Bigger tap targets on a phone, the shared component's normal size from
 * `sm` up — `NumberInput`/`Input` are fixed-height by design (see their
 * doc), so this overrides via `className` rather than asking that shared
 * component to grow a per-breakpoint size prop just for this form. */
const RESPONSIVE_HEIGHT = "h-control-lg sm:h-control";

export function TradeForm({
  mode,
  accountId,
  tradeId,
  instruments,
  tags,
  currency,
  defaults,
}: {
  mode: "create" | "edit";
  accountId: string;
  tradeId?: string;
  instruments: InstrumentOption[];
  tags: TagOption[];
  currency: string;
  defaults?: Partial<TradeFormInput>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <form
      ref={formRef}
      onSubmit={form.handleSubmit(onSubmit)}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-4"
    >
      <Panel>
        <PanelBody className="flex flex-col gap-4">
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

          {geometryWarnings.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-warn/30 bg-warn-weak px-3 py-2 text-xs text-warn">
              {geometryWarnings.map((w) => (
                <p key={w.code}>{w.message}</p>
              ))}
            </div>
          ) : null}

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

          <Field>
            <FieldLabel optional>Tags</FieldLabel>
            <Controller
              control={form.control}
              name="tagIds"
              render={({ field }) => (
                <div className="flex flex-wrap gap-1.5">
                  {tags.length === 0 ? <span className="text-xs text-ink-3">No tags yet.</span> : null}
                  {tags.map((tag) => {
                    const active = field.value.includes(tag.id);
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        onClick={() =>
                          field.onChange(
                            active ? field.value.filter((id) => id !== tag.id) : [...field.value, tag.id],
                          )
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
                </div>
              )}
            />
          </Field>
        </PanelBody>
      </Panel>

      <PreviewStrip preview={preview} />

      <Panel>
        <PanelHeader
          className="cursor-pointer select-none"
          onClick={() => setAdvancedOpen((v) => !v)}
          title="Discipline & notes"
          caption="Optional — costs, mindset, and a write-up"
          actions={
            <ChevronDown className={cn("size-4 text-ink-3 transition-transform", advancedOpen && "rotate-180")} />
          }
        />
        {advancedOpen ? (
          <PanelBody className="flex flex-col gap-4">
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
              <Textarea rows={5} placeholder="What was the setup? What would you do differently?" {...form.register("notes")} />
              <FieldError>{errors.notes?.message}</FieldError>
            </Field>
          </PanelBody>
        ) : null}
      </Panel>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="default" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : mode === "create" ? "Log trade" : "Save changes"}
          <kbd className="ml-1 hidden rounded-[3px] bg-black/15 px-1 text-2xs font-normal md:inline">⌘⏎</kbd>
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

interface Preview {
  pips: string;
  riskAmount: string;
  plannedRR: string;
  netPnl: string;
  netPnlIsProjection: boolean;
}

function buildPreview(
  values: Partial<TradeFormInput>,
  instrument: InstrumentOption | undefined,
  currency: string,
): Preview | null {
  if (!instrument || !values.direction) return null;
  const entry = Number(values.entryPrice);
  const volume = Number(values.volumeLots);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(volume) || volume <= 0) return null;
  const openedAt = values.openedAt ? new Date(values.openedAt) : null;
  if (!openedAt || Number.isNaN(openedAt.getTime())) return null;

  const spec = {
    symbol: instrument.symbol,
    pipSize: instrument.pipSize,
    contractSize: instrument.contractSize,
    digits: instrument.digits,
    quoteCurrency: instrument.quoteCurrency,
    assetClass: instrument.assetClass as AssetClass,
  };

  const stopLoss = values.stopLoss ? Number(values.stopLoss) : undefined;
  const takeProfit = values.takeProfit ? Number(values.takeProfit) : undefined;
  const closedAt = values.closedAt ? new Date(values.closedAt) : undefined;
  const commission = values.commission ? Number(values.commission) : 0;
  const swap = values.swap ? Number(values.swap) : 0;
  const conversionRate = values.conversionRate ? Number(values.conversionRate) : undefined;

  // riskAmount / plannedRR never need an exit price — compute them
  // regardless of whether one has been entered yet.
  let base;
  try {
    base = computeTrade({
      instrument: spec,
      direction: values.direction,
      entryPrice: entry,
      stopLoss,
      takeProfit,
      volumeLots: volume,
      commission,
      swap,
      conversionRate,
      openedAt,
      closedAt,
    });
  } catch {
    return null;
  }

  // netPnl/pips DO need an exit — use the real exit price if the trader has
  // entered one, otherwise fall back to the take-profit as a "what if this
  // hits target" projection, which is the number worth seeing before a
  // trade has even closed.
  const exitPrice = values.exitPrice ? Number(values.exitPrice) : takeProfit;
  const netPnlIsProjection = !values.exitPrice && !!takeProfit;
  let atExit = base;
  if (exitPrice !== undefined) {
    try {
      atExit = computeTrade({
        instrument: spec,
        direction: values.direction,
        entryPrice: entry,
        exitPrice,
        stopLoss,
        takeProfit,
        volumeLots: volume,
        commission,
        swap,
        conversionRate,
        openedAt,
        closedAt,
      });
    } catch {
      atExit = base;
    }
  }

  return {
    pips: formatPips(atExit.pips),
    riskAmount: base.riskAmount ? formatMoney(base.riskAmount, currency) : "—",
    plannedRR: base.plannedRR ? `${base.plannedRR.toFixed(2)}:1` : "—",
    netPnl: atExit.netPnl ? formatMoney(atExit.netPnl, currency) : "—",
    netPnlIsProjection,
  };
}

function buildWarnings(values: Partial<TradeFormInput>, instrument: InstrumentOption | undefined) {
  const entry = Number(values.entryPrice);
  if (!instrument || !values.direction || !Number.isFinite(entry) || entry <= 0) return [];
  const stopLoss = values.stopLoss ? Number(values.stopLoss) : undefined;
  const takeProfit = values.takeProfit ? Number(values.takeProfit) : undefined;
  const volumeLots = Number(values.volumeLots) || 0;
  const openedAt = values.openedAt ? new Date(values.openedAt) : new Date();
  const closedAt = values.closedAt ? new Date(values.closedAt) : undefined;

  try {
    return validateTradeGeometry({
      instrument: {
        symbol: instrument.symbol,
        pipSize: instrument.pipSize,
        contractSize: instrument.contractSize,
        digits: instrument.digits,
        quoteCurrency: instrument.quoteCurrency,
        assetClass: instrument.assetClass as AssetClass,
      },
      direction: values.direction,
      entryPrice: entry,
      stopLoss,
      takeProfit,
      volumeLots,
      openedAt,
      closedAt,
    });
  } catch {
    return [];
  }
}

function PreviewStrip({ preview }: { preview: Preview | null }) {
  return (
    <Panel className="bg-panel-sunken">
      <PanelBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Pips" value={preview ? preview.pips : "—"} />
        <Stat label="Risk" value={preview ? preview.riskAmount : "—"} />
        <Stat label="Planned R:R" value={preview ? preview.plannedRR : "—"} />
        <Stat
          label={preview?.netPnlIsProjection ? "Net P&L (at target)" : "Net P&L"}
          value={preview ? preview.netPnl : "—"}
          tone={preview?.netPnl && preview.netPnl.startsWith("-") ? "loss" : preview?.netPnl && preview.netPnl !== "—" ? "profit" : "neutral"}
        />
      </PanelBody>
    </Panel>
  );
}

export { isoToDatetimeLocal };
