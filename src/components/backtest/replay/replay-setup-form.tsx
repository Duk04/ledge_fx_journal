"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import {
  Panel,
  PanelHeader,
  PanelBody,
  PanelFooter,
  Field,
  FieldLabel,
  FieldRow,
  Input,
  NumberInput,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Switch,
  Button,
} from "@/components/ui";
import type { CoverageRow } from "@/lib/queries/candles";
import { createReplayRun } from "@/lib/actions/backtests";

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function ReplaySetupForm({ coverage }: { coverage: CoverageRow[] }) {
  const t = useTranslations("backtest");
  const router = useRouter();
  const symbolOptions = React.useMemo(() => Array.from(new Set(coverage.map((c) => c.symbol))).sort(), [coverage]);

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
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const matchingCoverage = coverage.find((c) => c.symbol === symbol && c.timeframe === timeframe) ?? null;
  const effectiveFrom = datesTouched ? from : matchingCoverage ? isoDate(matchingCoverage.firstTs) : "";
  const effectiveTo = datesTouched ? to : matchingCoverage ? isoDate(matchingCoverage.lastTs) : "";

  function handleStart() {
    setError(null);
    if (!symbol) {
      setError(t("form.chooseSymbolError"));
      return;
    }
    startTransition(async () => {
      const result = await createReplayRun({
        symbol,
        timeframe,
        from: effectiveFrom,
        to: effectiveTo,
        initialBalance,
        spreadPoints,
        commissionPerLot,
        slippagePoints,
        pessimisticFills,
      });
      // Narrowed on `ok` alone — see the note in strategy-workbench.tsx.
      if (!result.ok) {
        const firstFieldError = Object.values(result.fieldErrors ?? {}).flat()[0];
        setError(result.formError ?? firstFieldError ?? t("replay.startFailed"));
        return;
      }

      router.push(`/backtest/replay?runId=${result.runId}`);
    });
  }

  return (
    <Panel className="mx-auto w-full max-w-xl">
      <PanelHeader title={t("replay.title")} caption={t("replay.setupCaption")} />
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
          <p className="text-2xs text-warn">{t("form.noBarsStoredFirst", { symbol, timeframe })}</p>
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
            <NumberInput value={spreadPoints} onChange={(e) => setSpreadPoints(e.target.value)} unit={t("form.pts")} />
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

        {error ? <p className="text-xs text-loss">{error}</p> : null}
      </PanelBody>
      <PanelFooter className="justify-end">
        <Button variant="primary" onClick={handleStart} disabled={pending || !symbol || !effectiveFrom || !effectiveTo}>
          <Play /> {pending ? t("replay.starting") : t("replay.start")}
        </Button>
      </PanelFooter>
    </Panel>
  );
}
