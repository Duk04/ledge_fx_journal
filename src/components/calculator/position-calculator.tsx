"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import {
  Field,
  FieldHint,
  FieldLabel,
  FieldRow,
  NumberInput,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { resolveConversion } from "@/lib/conversion";
import { formatMoney } from "@/lib/metrics/formatters";
import type { InstrumentSpec } from "@/lib/metrics/types";
import { positionSize } from "@/lib/simulate/position-size";

export interface CalculatorInstrument extends InstrumentSpec {
  displayName: string;
  baseCurrency: string | null;
}

/**
 * Lots from a risk budget, before the trade — the risk guard's checks run
 * here first, as warnings, instead of only on the dashboard afterwards.
 */
export function PositionCalculator({
  instruments,
  currency,
  equity,
  riskPerTradePct,
  dailyLossRemaining,
}: {
  instruments: CalculatorInstrument[];
  currency: string;
  equity: number;
  riskPerTradePct: number | null;
  /** From the account's challenge rules; null when it has none. */
  dailyLossRemaining: number | null;
}) {
  const [symbol, setSymbol] = React.useState(
    instruments.find((i) => i.symbol === "EURUSD")?.symbol ?? instruments[0]?.symbol,
  );
  const [riskPct, setRiskPct] = React.useState(riskPerTradePct !== null ? String(riskPerTradePct) : "1");
  const [balance, setBalance] = React.useState(equity.toFixed(2));
  const [entry, setEntry] = React.useState("");
  const [stop, setStop] = React.useState("");
  const [rate, setRate] = React.useState("");

  const instrument = instruments.find((i) => i.symbol === symbol);
  const valid = instrument && Number(entry) > 0 && Number(stop) > 0 && Number(balance) > 0 && Number(riskPct) > 0;

  const conversion =
    instrument && Number(entry) > 0
      ? resolveConversion({ instrument, accountCurrency: currency, explicitRate: rate || null, referencePrice: entry })
      : null;

  const size =
    valid && conversion
      ? positionSize({ instrument, balance, riskPct, entry, stop, conversionRate: conversion.rate })
      : null;

  const warnings: string[] = [];
  if (riskPerTradePct !== null && Number(riskPct) > riskPerTradePct * 1.5) {
    warnings.push(`That is more than 1.5× your ${riskPerTradePct}% per-trade rule — the risk guard will flag it.`);
  }
  if (size && dailyLossRemaining !== null && size.riskAmount.toNumber() > dailyLossRemaining) {
    warnings.push(
      `A full loss (${formatMoney(size.riskAmount.toNumber(), currency)}) is more than today's remaining loss allowance (${formatMoney(dailyLossRemaining, currency)}).`,
    );
  }
  if (conversion?.needsAttention && !rate) {
    warnings.push(
      `${instrument?.quoteCurrency}→${currency} can't be derived from this pair's price — enter the conversion rate for an exact size.`,
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Panel className="lg:col-span-3">
        <PanelHeader title="Trade" />
        <PanelBody className="flex flex-col gap-4">
          <FieldRow>
            <Field>
              <FieldLabel>Instrument</FieldLabel>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {instruments.map((i) => (
                    <SelectItem key={i.symbol} value={i.symbol}>
                      {i.symbol} — {i.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Risk</FieldLabel>
              <NumberInput value={riskPct} onChange={(e) => setRiskPct(e.target.value)} unit="%" />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field>
              <FieldLabel>Entry price</FieldLabel>
              <NumberInput value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="0.00000" />
            </Field>
            <Field>
              <FieldLabel>Stop loss</FieldLabel>
              <NumberInput value={stop} onChange={(e) => setStop(e.target.value)} placeholder="0.00000" />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field>
              <FieldLabel>Balance</FieldLabel>
              <NumberInput value={balance} onChange={(e) => setBalance(e.target.value)} unit={currency} />
              <FieldHint>Defaults to this account&rsquo;s current balance.</FieldHint>
            </Field>
            <Field>
              <FieldLabel optional>Conversion rate</FieldLabel>
              <NumberInput value={rate} onChange={(e) => setRate(e.target.value)} placeholder="auto" />
              <FieldHint>
                {instrument?.quoteCurrency} → {currency}. Only needed when the pair doesn&rsquo;t imply it.
              </FieldHint>
            </Field>
          </FieldRow>
        </PanelBody>
      </Panel>

      <Panel className="lg:col-span-2">
        <PanelHeader title="Size" />
        <PanelBody className="flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-xs text-ink-3">Lots</span>
            <span className="mono text-3xl text-ink" aria-live="polite" data-testid="lots">
              {size ? size.lots.toFixed(2) : "—"}
            </span>
          </div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-2">Stop distance</dt>
              <dd className="mono">{size ? `${size.stopPips.toDecimalPlaces(1).toString()} pips` : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-2">Risk budget</dt>
              <dd className="mono">{size ? formatMoney(size.budget.toNumber(), currency) : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-2">Actually risked</dt>
              <dd className="mono">{size ? formatMoney(size.riskAmount.toNumber(), currency) : "—"}</dd>
            </div>
          </dl>
          <p className="text-2xs text-ink-3">Rounded down to 0.01 lots — never more risk than the budget.</p>
          {warnings.map((w) => (
            <p
              key={w}
              className="flex gap-2 rounded-[var(--radius-control)] border border-warn/30 bg-warn-weak px-2.5 py-2 text-xs text-warn"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {w}
            </p>
          ))}
        </PanelBody>
      </Panel>
    </div>
  );
}
