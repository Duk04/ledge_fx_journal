"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
      setError("Choose a symbol.");
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
      if (result.ok && result.runId) {
        router.push(`/backtest/replay?runId=${result.runId}`);
      } else {
        setError(result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? "Couldn't start that replay.");
      }
    });
  }

  return (
    <Panel className="mx-auto w-full max-w-xl">
      <PanelHeader title="New replay" caption="step through bars by hand and place trades yourself" />
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
          <p className="text-2xs text-warn">
            No {symbol} {timeframe} bars stored — pick a different timeframe or import data first.
          </p>
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

        {error ? <p className="text-xs text-loss">{error}</p> : null}
      </PanelBody>
      <PanelFooter className="justify-end">
        <Button variant="primary" onClick={handleStart} disabled={pending || !symbol || !effectiveFrom || !effectiveTo}>
          <Play /> {pending ? "Starting…" : "Start replay"}
        </Button>
      </PanelFooter>
    </Panel>
  );
}
