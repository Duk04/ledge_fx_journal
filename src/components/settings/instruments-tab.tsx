"use client";

import * as React from "react";
import { Pencil, Check, X, RotateCcw } from "lucide-react";
import { DataTable, Th, Td, Button, useToast, NumberInput, Input, Badge } from "@/components/ui";
import { updateInstrument, resetInstrumentsToDefaults } from "@/app/(app)/settings/actions";
import type { InstrumentRow } from "@/lib/queries/settings";

/**
 * `canEdit` is the instance-owner check, resolved on the server and passed
 * down. Members see the table read-only with an explanation, rather than
 * edit controls that fail on submit — `Instrument` is one shared table
 * feeding every user's P&L, so writes are owner-only (see
 * app/(app)/settings/actions.ts).
 */
export function InstrumentsTab({
  initialInstruments,
  canEdit,
}: {
  initialInstruments: InstrumentRow[];
  canEdit: boolean;
}) {
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
          {canEdit ? (
            <>
              These values decide every pip and P&amp;L number in the app, and brokers differ on pip size, contract
              size, and quote precision for the same symbol. If a number looks wrong, this is the first place to
              check &mdash; and editing a row changes it for <strong>every</strong> account on this instance.
            </>
          ) : (
            <>
              These values decide every pip and P&amp;L number in the app. They are shared by every account here, so
              only the instance owner can change them &mdash; ask them if a symbol looks wrong for your broker.
            </>
          )}
        </p>
        {canEdit ? (
          <Button variant="default" size="sm" className="shrink-0" onClick={handleReset} disabled={resetting}>
            <RotateCcw /> Reset to defaults
          </Button>
        ) : null}
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
            <InstrumentRowItem key={inst.symbol} instrument={inst} canEdit={canEdit} />
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

function InstrumentRowItem({ instrument, canEdit }: { instrument: InstrumentRow; canEdit: boolean }) {
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
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${instrument.symbol}`}
              onClick={() => setEditing(true)}
              disabled={!canEdit}
              title={canEdit ? undefined : "Only the instance owner can change shared instrument data."}
            >
              <Pencil />
            </Button>
          )}
        </div>
        {error ? <div className="mt-1 text-2xs text-loss">{error}</div> : null}
      </Td>
    </tr>
  );
}
