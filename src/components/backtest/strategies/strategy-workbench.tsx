"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Play, Save, Trash2, FileCode } from "lucide-react";
import {
  Panel,
  PanelHeader,
  PanelBody,
  PanelFooter,
  Field,
  FieldLabel,
  FieldError,
  FieldRow,
  Input,
  Textarea,
  NumberInput,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Switch,
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  useToast,
} from "@/components/ui";
import type { ExampleStrategy } from "@/lib/backtest";
import type { StrategyDetail } from "@/lib/queries/backtests";
import type { CoverageRow } from "@/lib/queries/candles";
import { createStrategy, updateStrategy, deleteStrategy } from "@/lib/actions/strategies";
import { recordStrategyRun } from "@/lib/actions/backtests";
import { useStrategyRunner } from "./use-strategy-runner";
import { ParamsEditor, type ParamRecord } from "./params-editor";
import { StrategyApiReference } from "./api-reference";

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function StrategyWorkbench({
  strategy,
  templates,
  symbolOptions,
  coverage,
}: {
  strategy: StrategyDetail | null;
  templates: ExampleStrategy[];
  symbolOptions: string[];
  coverage: CoverageRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = React.useState(strategy?.name ?? "");
  const [description, setDescription] = React.useState(strategy?.description ?? "");
  const [code, setCode] = React.useState(strategy?.code ?? templates[0]?.code ?? "");
  const [params, setParams] = React.useState<ParamRecord>(strategy?.params ?? templates[0]?.params ?? {});
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [saving, startSaving] = React.useTransition();
  const [running, startRunning] = React.useTransition();
  const runner = useStrategyRunner();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, startDeleting] = React.useTransition();

  const dirty = strategy ? code !== strategy.code : true;

  // ------------------------------------------------------------ run form
  const [symbol, setSymbol] = React.useState(symbolOptions[0] ?? "");
  const [timeframe, setTimeframe] = React.useState<(typeof TIMEFRAMES)[number]>("M15");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [datesTouched, setDatesTouched] = React.useState(false);
  const [initialBalance, setInitialBalance] = React.useState("10000");
  const [spreadPoints, setSpreadPoints] = React.useState("10");
  const [commissionPerLot, setCommissionPerLot] = React.useState("0");
  const [slippagePoints, setSlippagePoints] = React.useState("0");
  const [pessimisticFills, setPessimisticFills] = React.useState(true);
  const [runError, setRunError] = React.useState<string | null>(null);

  const matchingCoverage = coverage.find((c) => c.symbol === symbol && c.timeframe === timeframe) ?? null;

  // Defaulted from coverage, but only until the user edits a date field
  // themselves — computed at render time (not an effect) so picking a
  // different symbol/timeframe updates the shown range immediately.
  const effectiveFrom = datesTouched ? from : matchingCoverage ? isoDate(matchingCoverage.firstTs) : "";
  const effectiveTo = datesTouched ? to : matchingCoverage ? isoDate(matchingCoverage.lastTs) : "";

  function loadTemplate(t: ExampleStrategy) {
    setName((prev) => prev || t.name);
    setDescription((prev) => prev || t.description);
    setCode(t.code);
    setParams({ ...t.params });
    setCodeError(null);
  }

  function handleSave() {
    setNameError(null);
    setCodeError(null);
    startSaving(async () => {
      const input = { name, description: description || undefined, code, params };
      const result = strategy ? await updateStrategy(strategy.id, input) : await createStrategy(input);
      if (result.ok) {
        toast({ title: strategy ? "Strategy saved." : "Strategy created." });
        if (!strategy && "id" in result && result.id) {
          router.push(`/backtest/strategies?id=${result.id}`);
        } else {
          router.refresh();
        }
      } else {
        setNameError(result.fieldErrors?.name?.[0] ?? null);
        setCodeError(result.fieldErrors?.code?.[0] ?? result.formError ?? null);
      }
    });
  }

  function handleDelete() {
    if (!strategy) return;
    startDeleting(async () => {
      const result = await deleteStrategy(strategy.id);
      setDeleteOpen(false);
      if (result.ok) {
        toast({ title: "Strategy deleted." });
        router.push("/backtest/strategies");
      } else {
        toast({ title: "Couldn't delete strategy", description: result.formError, tone: "loss" });
      }
    });
  }

  /**
   * Runs the strategy in a Web Worker, then posts the resulting trades.
   *
   * The strategy's code never leaves this browser: it is compiled and
   * executed in a worker owned by this page (see
   * src/lib/backtest/worker.ts). The server's job is to hand over the bars,
   * and afterwards to persist the trades and recompute the run's statistics
   * from them — it never compiles or runs the source.
   */
  function handleRun() {
    setRunError(null);
    if (!symbol) {
      setRunError("Choose a symbol.");
      return;
    }

    startRunning(async () => {
      let payload;
      try {
        payload = await runner.fetchBars({ symbol, timeframe, from: effectiveFrom, to: effectiveTo });
      } catch (err) {
        setRunError(err instanceof Error ? err.message : "Couldn't load bars for that range.");
        return;
      }

      const outcome = await runner.run({
        code,
        bars: payload.bars,
        config: {
          instrument: payload.instrument,
          fill: {
            // The form holds these as strings; the engine wants numbers. The
            // server action still coerces its own copy independently — this
            // is the client's, for the client's simulation.
            spreadPoints: Number(spreadPoints),
            commissionPerLot: Number(commissionPerLot),
            slippagePoints: Number(slippagePoints),
            pessimisticFills,
            conversionRate: payload.conversionRate,
          },
          initialBalance: Number(initialBalance),
          params,
        },
      });

      if (!outcome.ok || !outcome.result) {
        setRunError(outcome.error ?? "The strategy didn't finish.");
        return;
      }

      const saved = await recordStrategyRun({
        // Only sent when the editor matches the saved strategy, so the run is
        // attributed to it. Unsaved edits run all the same; the server just
        // has nothing to link them to.
        strategyId: strategy && !dirty ? strategy.id : undefined,
        symbol,
        timeframe,
        from: effectiveFrom,
        to: effectiveTo,
        initialBalance,
        params,
        spreadPoints,
        commissionPerLot,
        slippagePoints,
        pessimisticFills,
        result: {
          trades: outcome.result.trades,
          barsProcessed: outcome.result.barsProcessed,
          logs: outcome.result.logs,
          error: outcome.result.error ?? undefined,
        },
      });

      // Narrow on `ok` alone. `saved.ok && saved.runId` reads naturally but
      // does not narrow: the compiler cannot rule out the success arm on the
      // other side of it, so `saved.formError` is not available there. Under
      // the old intersection type both arms carried every field optionally, so
      // this compiled and silently read undefined.
      if (!saved.ok) {
        const firstFieldError = Object.values(saved.fieldErrors ?? {}).flat()[0];
        setRunError(saved.formError ?? firstFieldError ?? "The run finished but couldn't be saved.");
        return;
      }

      toast({ title: "Run complete." });
      router.push(`/backtest/runs/${saved.runId}`);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="flex flex-col gap-4 xl:col-span-7">
        <Panel>
          <PanelHeader
            title={strategy ? strategy.name : "New strategy"}
            actions={
              <>
                {templates.map((t) => (
                  <Button key={t.name} variant="ghost" size="sm" onClick={() => loadTemplate(t)}>
                    <FileCode /> {t.name}
                  </Button>
                ))}
              </>
            }
          />
          <PanelBody className="flex flex-col gap-3">
            <FieldRow>
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My EMA cross" />
                <FieldError>{nameError}</FieldError>
              </Field>
              <Field>
                <FieldLabel optional>Description</FieldLabel>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this strategy does" />
              </Field>
            </FieldRow>
            <Field>
              <FieldLabel>Code</FieldLabel>
              <Textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                className="mono min-h-80 text-xs leading-relaxed"
              />
              <FieldError>{codeError}</FieldError>
            </Field>
            <Field>
              <FieldLabel>Parameters</FieldLabel>
              <ParamsEditor params={params} onChange={setParams} />
            </Field>
          </PanelBody>
          <PanelFooter>
            <span className="text-2xs text-ink-3">
              {strategy ? (dirty ? "Unsaved changes" : "Saved") : "Not saved yet"}
            </span>
            <div className="flex items-center gap-1.5">
              {strategy ? (
                <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                  <Trash2 /> Delete
                </Button>
              ) : null}
              <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
                <Save /> {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </PanelFooter>
        </Panel>

        <StrategyApiReference />
      </div>

      <div className="flex flex-col gap-4 xl:col-span-5">
        <Panel>
          <PanelHeader title="Run" caption="over a historical range" />
          <PanelBody className="flex flex-col gap-3">
            <Field>
              <FieldLabel>Symbol</FieldLabel>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a symbol" />
                </SelectTrigger>
                <SelectContent>
                  {symbolOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Timeframe</FieldLabel>
              <Select value={timeframe} onValueChange={(v) => setTimeframe(v as (typeof TIMEFRAMES)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((tf) => (
                    <SelectItem key={tf} value={tf}>
                      {tf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {matchingCoverage ? (
              <p className="text-2xs text-ink-3">
                {matchingCoverage.barCount.toLocaleString()} bars stored, {isoDate(matchingCoverage.firstTs)} to{" "}
                {isoDate(matchingCoverage.lastTs)}.
              </p>
            ) : symbol ? (
              <p className="text-2xs text-warn">No {symbol} {timeframe} bars stored — pick a different timeframe or import data.</p>
            ) : null}

            <FieldRow>
              <Field>
                <FieldLabel>From</FieldLabel>
                <Input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => {
                    setDatesTouched(true);
                    setFrom(e.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel>To</FieldLabel>
                <Input
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => {
                    setDatesTouched(true);
                    setTo(e.target.value);
                  }}
                />
              </Field>
            </FieldRow>

            <Field>
              <FieldLabel>Initial balance</FieldLabel>
              <NumberInput value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} unit="USD" />
            </Field>

            <FieldRow>
              <Field>
                <FieldLabel>Spread</FieldLabel>
                <NumberInput value={spreadPoints} onChange={(e) => setSpreadPoints(e.target.value)} unit="pts" />
              </Field>
              <Field>
                <FieldLabel>Slippage</FieldLabel>
                <NumberInput value={slippagePoints} onChange={(e) => setSlippagePoints(e.target.value)} unit="pts" />
              </Field>
            </FieldRow>
            <Field>
              <FieldLabel>Commission</FieldLabel>
              <NumberInput value={commissionPerLot} onChange={(e) => setCommissionPerLot(e.target.value)} unit="per lot/side" />
            </Field>
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>Pessimistic fills</FieldLabel>
                <Switch checked={pessimisticFills} onCheckedChange={setPessimisticFills} />
              </div>
            </Field>

            {runError ? <p className="text-xs text-loss">{runError}</p> : null}
          </PanelBody>
          <PanelFooter>
            <span className="text-2xs text-ink-3">
              {dirty ? "Runs the code above as written" : "Runs the saved strategy"}
              {strategy && !dirty ? <Badge tone="neutral" className="ml-1.5">saved</Badge> : null}
            </span>
            <Button variant="primary" size="sm" onClick={handleRun} disabled={running || !symbol || !effectiveFrom || !effectiveTo}>
              <Play /> {running ? "Running…" : "Run"}
            </Button>
          </PanelFooter>
        </Panel>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader
            title="Delete this strategy?"
            description={`"${strategy?.name}" will be removed. Runs already made from it keep their own copy of the results and stay in your run list.`}
          />
          <DialogFooter>
            <Button variant="default" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
