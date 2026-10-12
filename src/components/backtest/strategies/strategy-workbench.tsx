"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("backtest");
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

  function loadTemplate(tpl: ExampleStrategy) {
    setName((prev) => prev || tpl.name);
    setDescription((prev) => prev || tpl.description);
    setCode(tpl.code);
    setParams({ ...tpl.params });
    setCodeError(null);
  }

  function handleSave() {
    setNameError(null);
    setCodeError(null);
    startSaving(async () => {
      const input = { name, description: description || undefined, code, params };
      const result = strategy ? await updateStrategy(strategy.id, input) : await createStrategy(input);
      if (result.ok) {
        toast({ title: strategy ? t("workbench.strategySaved") : t("workbench.strategyCreated") });
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
        toast({ title: t("workbench.strategyDeleted") });
        router.push("/backtest/strategies");
      } else {
        toast({ title: t("workbench.couldNotDelete"), description: result.formError, tone: "loss" });
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
      setRunError(t("form.chooseSymbolError"));
      return;
    }

    startRunning(async () => {
      let payload;
      try {
        payload = await runner.fetchBars({ symbol, timeframe, from: effectiveFrom, to: effectiveTo });
      } catch (err) {
        setRunError(err instanceof Error ? err.message : t("workbench.loadBarsFailed"));
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
        setRunError(outcome.error ?? t("workbench.didntFinish"));
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
        setRunError(saved.formError ?? firstFieldError ?? t("workbench.saveRunFailed"));
        return;
      }

      toast({ title: t("workbench.runComplete") });
      router.push(`/backtest/runs/${saved.runId}`);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="flex flex-col gap-4 xl:col-span-7">
        <Panel>
          <PanelHeader
            title={strategy ? strategy.name : t("workbench.newStrategy")}
            actions={
              <>
                {templates.map((tpl) => (
                  <Button key={tpl.name} variant="ghost" size="sm" onClick={() => loadTemplate(tpl)}>
                    <FileCode /> {tpl.name}
                  </Button>
                ))}
              </>
            }
          />
          <PanelBody className="flex flex-col gap-3">
            <FieldRow>
              <Field>
                <FieldLabel>{t("workbench.name")}</FieldLabel>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("workbench.namePlaceholder")}
                />
                <FieldError>{nameError}</FieldError>
              </Field>
              <Field>
                <FieldLabel optional>{t("workbench.description")}</FieldLabel>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("workbench.descriptionPlaceholder")}
                />
              </Field>
            </FieldRow>
            <Field>
              <FieldLabel>{t("workbench.code")}</FieldLabel>
              <Textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                className="mono min-h-80 text-xs leading-relaxed"
              />
              <FieldError>{codeError}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("workbench.parameters")}</FieldLabel>
              <ParamsEditor params={params} onChange={setParams} />
            </Field>
          </PanelBody>
          <PanelFooter>
            <span className="text-2xs text-ink-3">
              {strategy ? (dirty ? t("workbench.unsaved") : t("workbench.savedState")) : t("workbench.notSaved")}
            </span>
            <div className="flex items-center gap-1.5">
              {strategy ? (
                <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                  <Trash2 /> {t("common.delete")}
                </Button>
              ) : null}
              {/* Run is this page's primary action; saving is secondary. */}
              <Button variant="default" size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
                <Save /> {saving ? t("workbench.saving") : t("workbench.save")}
              </Button>
            </div>
          </PanelFooter>
        </Panel>

        <StrategyApiReference />
      </div>

      <div className="flex flex-col gap-4 xl:col-span-5">
        <Panel>
          <PanelHeader title={t("workbench.run")} caption={t("workbench.runCaption")} />
          <PanelBody className="flex flex-col gap-3">
            <Field>
              <FieldLabel>{t("form.symbol")}</FieldLabel>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger>
                  <SelectValue placeholder={t("form.chooseSymbol")} />
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
              <FieldLabel>{t("form.timeframe")}</FieldLabel>
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
                {t("form.barsStored", {
                  count: matchingCoverage.barCount.toLocaleString(),
                  from: isoDate(matchingCoverage.firstTs),
                  to: isoDate(matchingCoverage.lastTs),
                })}
              </p>
            ) : symbol ? (
              <p className="text-2xs text-warn">{t("form.noBarsStored", { symbol, timeframe })}</p>
            ) : null}

            <FieldRow>
              <Field>
                <FieldLabel>{t("form.from")}</FieldLabel>
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
                <FieldLabel>{t("form.to")}</FieldLabel>
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
              <FieldLabel>{t("form.initialBalance")}</FieldLabel>
              <NumberInput value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} unit="USD" />
            </Field>

            <FieldRow>
              <Field>
                <FieldLabel>{t("form.spread")}</FieldLabel>
                <NumberInput
                  value={spreadPoints}
                  onChange={(e) => setSpreadPoints(e.target.value)}
                  unit={t("form.pts")}
                />
              </Field>
              <Field>
                <FieldLabel>{t("form.slippage")}</FieldLabel>
                <NumberInput
                  value={slippagePoints}
                  onChange={(e) => setSlippagePoints(e.target.value)}
                  unit={t("form.pts")}
                />
              </Field>
            </FieldRow>
            <Field>
              <FieldLabel>{t("form.commission")}</FieldLabel>
              <NumberInput
                value={commissionPerLot}
                onChange={(e) => setCommissionPerLot(e.target.value)}
                unit={t("form.perLotSide")}
              />
            </Field>
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>{t("form.pessimisticFills")}</FieldLabel>
                <Switch checked={pessimisticFills} onCheckedChange={setPessimisticFills} />
              </div>
            </Field>

            {runError ? <p className="text-xs text-loss">{runError}</p> : null}
          </PanelBody>
          <PanelFooter>
            <span className="text-2xs text-ink-3">
              {dirty ? t("workbench.runsAsWritten") : t("workbench.runsSaved")}
              {strategy && !dirty ? (
                <Badge tone="neutral" className="ml-1.5">
                  {t("workbench.savedBadge")}
                </Badge>
              ) : null}
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRun}
              disabled={running || !symbol || !effectiveFrom || !effectiveTo}
            >
              <Play /> {running ? t("workbench.running") : t("workbench.run")}
            </Button>
          </PanelFooter>
        </Panel>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader
            title={t("workbench.deleteTitle")}
            description={t("workbench.deleteDescription", { name: String(strategy?.name) })}
          />
          <DialogFooter>
            <Button variant="default" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
