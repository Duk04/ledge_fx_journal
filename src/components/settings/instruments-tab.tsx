"use client";

import * as React from "react";
import { Pencil, Check, X, RotateCcw } from "lucide-react";
import { DataTable, Th, Td, Button, useToast, NumberInput, Input, Badge } from "@/components/ui";
import { updateInstrument, resetInstrumentsToDefaults } from "@/app/(app)/settings/actions";
import type { InstrumentRow } from "@/lib/queries/settings";

export function InstrumentsTab({ initialInstruments }: { initialInstruments: InstrumentRow[] }) {
  const [resetting, setResetting] = React.useState(false);
  const { toast } = useToast();

  async function handleReset() {
    setResetting(true);
    const result = await resetInstrumentsToDefaults();
    setResetting(false);
    if (result.ok) toast({ title: "Instruments reset to defaults." });
    else toast({ title: "Could not reset", description: result.formError, tone: "loss" });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 rounded-[var(--radius-panel)] border border-warn/30 bg-warn-weak px-3 py-2.5 text-xs text-ink-2 sm:flex-row sm:items-center">
        <p>
          These values decide every pip and P&amp;L number in the app, and brokers differ on pip size, contract
          size, and quote precision for the same symbol. If a number looks wrong, this is the first place to check.
        </p>
        <Button variant="default" size="sm" className="shrink-0" onClick={handleReset} disabled={resetting}>
          <RotateCcw /> Reset to defaults
        </Button>
      </div>

      <DataTable>
        <thead>
          <tr>
            <Th>Symbol</Th>
            <Th>Class</Th>
            <Th numeric>Pip size</Th>
            <Th numeric>Contract size</Th>
            <Th numeric>Digits</Th>
            <Th>Quote</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {initialInstruments.map((inst) => (
            <InstrumentRowItem key={inst.symbol} instrument={inst} />
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

function InstrumentRowItem({ instrument }: { instrument: InstrumentRow }) {
  const [editing, setEditing] = React.useState(false);
  const [pipSize, setPipSize] = React.useState(instrument.pipSize);
  const [contractSize, setContractSize] = React.useState(instrument.contractSize);
  const [digits, setDigits] = React.useState(String(instrument.digits));
  const [quoteCurrency, setQuoteCurrency] = React.useState(instrument.quoteCurrency);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { toast } = useToast();

  function cancel() {
    setEditing(false);
    setPipSize(instrument.pipSize);
    setContractSize(instrument.contractSize);
    setDigits(String(instrument.digits));
    setQuoteCurrency(instrument.quoteCurrency);
    setError(null);
  }

  async function save() {
    setPending(true);
    setError(null);
    const result = await updateInstrument(instrument.symbol, {
      pipSize,
      contractSize,
      digits: Number(digits),
      quoteCurrency,
    });
    setPending(false);
    if (result.ok) {
      toast({ title: `${instrument.symbol} updated.` });
      setEditing(false);
    } else {
      setError(result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? "Could not save.");
    }
  }

  return (
    <tr>
      <Td className="font-medium text-ink">{instrument.symbol}</Td>
      <Td>
        <Badge tone="neutral">{instrument.assetClass}</Badge>
      </Td>
      {editing ? (
        <>
          <Td numeric>
            <NumberInput value={pipSize} onChange={(e) => setPipSize(e.target.value)} className="w-24" />
          </Td>
          <Td numeric>
            <NumberInput value={contractSize} onChange={(e) => setContractSize(e.target.value)} className="w-24" />
          </Td>
          <Td numeric>
            <NumberInput value={digits} onChange={(e) => setDigits(e.target.value)} className="w-14" />
          </Td>
          <Td>
            <Input
              value={quoteCurrency}
              onChange={(e) => setQuoteCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              className="w-16"
            />
          </Td>
        </>
      ) : (
        <>
          <Td numeric>{instrument.pipSize}</Td>
          <Td numeric>{instrument.contractSize}</Td>
          <Td numeric>{instrument.digits}</Td>
          <Td>{instrument.quoteCurrency}</Td>
        </>
      )}
      <Td>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Save" onClick={save} disabled={pending}>
                <Check />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Cancel" onClick={cancel}>
                <X />
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${instrument.symbol}`} onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
          )}
        </div>
        {error ? <div className="mt-1 text-2xs text-loss">{error}</div> : null}
      </Td>
    </tr>
  );
}
