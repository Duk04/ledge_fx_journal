"use client";

import { useTranslations } from "next-intl";

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
  const t = useTranslations("settings.instruments");
  const [resetting, setResetting] = React.useState(false);
  const { toast } = useToast();

  async function handleReset() {
    setResetting(true);
    const result = await resetInstrumentsToDefaults();
    setResetting(false);
    if (result.ok) toast({ title: t("resetDone") });
    else toast({ title: t("couldNotReset"), description: result.formError, tone: "loss" });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 rounded-[var(--radius-panel)] border border-warn/30 bg-warn-weak px-3 py-2.5 text-xs text-ink-2 sm:flex-row sm:items-center">
        <p>{canEdit ? t("ownerNote") : t("memberNote")}</p>
        {canEdit ? (
          <Button variant="default" size="sm" className="shrink-0" onClick={handleReset} disabled={resetting}>
            <RotateCcw /> {t("reset")}
          </Button>
        ) : null}
      </div>

      <DataTable>
        <thead>
          <tr>
            <Th>{t("symbol")}</Th>
            <Th>{t("class")}</Th>
            <Th numeric>{t("pipSize")}</Th>
            <Th numeric>{t("contractSize")}</Th>
            <Th numeric>{t("digits")}</Th>
            <Th>{t("quote")}</Th>
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
  const t = useTranslations("settings.instruments");
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
      toast({ title: t("updated", { symbol: instrument.symbol }) });
      setEditing(false);
    } else {
      setError(result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? t("couldNotSave"));
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
              <Button variant="ghost" size="icon-sm" aria-label={t("save")} onClick={save} disabled={pending}>
                <Check />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={t("cancel")} onClick={cancel}>
                <X />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("editSymbol", { symbol: instrument.symbol })}
              onClick={() => setEditing(true)}
              disabled={!canEdit}
              title={canEdit ? undefined : t("ownerOnly")}
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
