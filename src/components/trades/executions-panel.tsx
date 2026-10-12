"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  Field,
  FieldLabel,
  Input,
  NumberInput,
  Panel,
  PanelBody,
  PanelHeader,
  Segmented,
  SegmentedItem,
  Td,
  Th,
  useToast,
} from "@/components/ui";
import { addExecution, deleteExecution } from "@/lib/actions/executions";
import { formatInZone, formatPrice } from "@/lib/metrics/formatters";
import type { TradeExecution } from "@/lib/queries/trades";
import { datetimeLocalToIso, toDatetimeLocal } from "./trade-form-values";

/**
 * A trade's fills: scale in with another ENTRY, take a partial with an EXIT,
 * or remove a mistyped one. The trade's prices, size, times and status are
 * re-derived from these after every change (lib/actions/executions.ts), so
 * this panel is the place to edit them once a trade has more than one fill.
 */
export function ExecutionsPanel({
  accountId,
  tradeId,
  digits,
  timezone,
  executions,
  openLots,
  cancelled,
}: {
  accountId: string;
  tradeId: string;
  digits: number;
  timezone: string;
  executions: TradeExecution[];
  openLots: string;
  cancelled: boolean;
}) {
  const t = useTranslations("trades.detail.fills");
  const router = useRouter();
  const { toast } = useToast();
  const [adding, setAdding] = React.useState(false);
  const [kind, setKind] = React.useState<"ENTRY" | "EXIT">("EXIT");
  const [executedAt, setExecutedAt] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [lots, setLots] = React.useState("");
  const [pending, setPending] = React.useState(false);
  // The only entry can't be removed (deleteExecution refuses it); offer no
  // button rather than one that fails.
  const soleEntry = executions.filter((e) => e.kind === "ENTRY").length === 1;

  function startAdding() {
    setExecutedAt(toDatetimeLocal(new Date()));
    setLots(Number(openLots) > 0 ? openLots : "");
    setPrice("");
    setKind(Number(openLots) > 0 ? "EXIT" : "ENTRY");
    setAdding(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await addExecution(accountId, tradeId, {
      kind,
      executedAt: datetimeLocalToIso(executedAt),
      price,
      volumeLots: lots,
    });
    setPending(false);
    if (!res.ok) {
      toast({ title: t("addFailed"), description: res.formError ?? t("checkFields"), tone: "loss" });
      return;
    }
    toast({ title: res.status === "CLOSED" ? t("addedClosed") : t("added") });
    setAdding(false);
    router.refresh();
  }

  async function remove(id: string) {
    const res = await deleteExecution(accountId, tradeId, id);
    if (!res.ok) {
      toast({ title: t("removeFailed"), description: res.formError, tone: "loss" });
      return;
    }
    router.refresh();
  }

  return (
    <Panel flush>
      <PanelHeader
        title={t("title")}
        caption={Number(openLots) > 0 ? t("lotsOpen", { lots: openLots }) : t("flat")}
        actions={
          cancelled ? null : (
            <Button variant="ghost" size="sm" onClick={startAdding} disabled={adding}>
              <Plus aria-hidden /> {t("add")}
            </Button>
          )
        }
      />
      <DataTable>
        <thead>
          <tr>
            <Th>{t("kind")}</Th>
            <Th>{t("time")}</Th>
            <Th numeric>{t("price")}</Th>
            <Th numeric>{t("lots")}</Th>
            <Th aria-label={t("actions")} />
          </tr>
        </thead>
        <tbody>
          {executions.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-xs text-ink-3">
                {cancelled ? t("cancelledEmpty") : t("empty")}
              </Td>
            </tr>
          ) : (
            executions.map((e) => (
              <tr key={e.id}>
                <Td>
                  <Badge tone={e.kind === "ENTRY" ? "outline" : "neutral"}>
                    {e.kind === "ENTRY" ? t("entry") : t("exit")}
                  </Badge>
                </Td>
                <Td className="mono text-xs">{formatInZone(e.executedAt, timezone, "MMM d, HH:mm")}</Td>
                <Td numeric className="mono text-xs">
                  {formatPrice(Number(e.price), digits)}
                </Td>
                <Td numeric className="mono text-xs">
                  {e.volumeLots}
                </Td>
                <Td numeric>
                  {soleEntry && e.kind === "ENTRY" ? null : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t(e.kind === "ENTRY" ? "removeEntry" : "removeExit", { price: e.price })}
                      onClick={() => remove(e.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>

      {adding ? (
        <PanelBody>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Segmented
              value={kind}
              onValueChange={(v) => v && setKind(v as "ENTRY" | "EXIT")}
              aria-label={t("kindLabel")}
            >
              <SegmentedItem value="ENTRY">{t("entryOption")}</SegmentedItem>
              <SegmentedItem value="EXIT">{t("exitOption")}</SegmentedItem>
            </Segmented>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel>{t("time")}</FieldLabel>
                <Input
                  type="datetime-local"
                  value={executedAt}
                  onChange={(e) => setExecutedAt(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>{t("price")}</FieldLabel>
                <NumberInput value={price} onChange={(e) => setPrice(e.target.value)} required />
              </Field>
              <Field>
                <FieldLabel>{t("lots")}</FieldLabel>
                <NumberInput value={lots} onChange={(e) => setLots(e.target.value)} required unit={t("lotsUnit")} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? t("adding") : t("add")}
              </Button>
            </div>
          </form>
        </PanelBody>
      ) : null}
    </Panel>
  );
}
