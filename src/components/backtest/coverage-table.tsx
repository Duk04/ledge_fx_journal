"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DataTable,
  Th,
  Td,
  TableEmpty,
  Badge,
  Button,
  EmptyState,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  useToast,
} from "@/components/ui";
import { deleteCandles } from "@/lib/actions/candles";

export interface CoverageTableRow {
  symbol: string;
  timeframe: string;
  barCount: number;
  firstTs: number;
  lastTs: number;
  source: string;
  estimatedGaps: number;
  latestImport: { fileName: string | null; createdAt: string; rowCount: number; tzOffsetMinutes: number } | null;
}

/** Sources with a translated label; anything else (a source added to the
 * schema later) falls back to its raw enum name rather than a missing key. */
const KNOWN_SOURCES = ["MT5_CSV", "GENERIC_CSV", "API"] as const;

function isKnownSource(source: string): source is (typeof KNOWN_SOURCES)[number] {
  return (KNOWN_SOURCES as readonly string[]).includes(source);
}

/** Bytes-per-row estimate for the per-symbol storage column. Not measured
 * per group (Postgres has no cheap way to size an arbitrary WHERE-filtered
 * slice of a table) — derived from the same ~35MB / 370k-rows-per-year
 * figure the schema doc quotes for a year of M1, so the estimate and the
 * storage warning elsewhere on the page stay consistent with each other. */
const BYTES_PER_ROW_ESTIMATE = 95;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * `canDelete` is the instance-owner check, resolved on the server. Candle
 * data is shared by every account here, so deleting a range takes it away
 * from everyone — the action is owner-only (see lib/actions/candles.ts) and
 * the control is hidden rather than left to fail on submit.
 */
export function CoverageTable({ rows, canDelete }: { rows: CoverageTableRow[]; canDelete: boolean }) {
  const t = useTranslations("backtest.coverage");
  const [deleteTarget, setDeleteTarget] = React.useState<CoverageTableRow | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t("emptyTitle")}
        description={t.rich("emptyDescription", { strong: (chunks) => <strong>{chunks}</strong> })}
      />
    );
  }

  return (
    <>
      <DataTable>
        <thead>
          <tr>
            <Th>{t("symbol")}</Th>
            <Th>{t("timeframe")}</Th>
            <Th numeric>{t("bars")}</Th>
            <Th>{t("firstLast")}</Th>
            <Th numeric>{t("gaps")}</Th>
            <Th>{t("source")}</Th>
            <Th numeric>{t("storage")}</Th>
            <Th>{t("latestImport")}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={9}>{t("nothing")}</TableEmpty>
          ) : (
            rows.map((row) => (
              <tr key={`${row.symbol}-${row.timeframe}`}>
                <Td className="mono font-medium text-ink">{row.symbol}</Td>
                <Td className="mono">{row.timeframe}</Td>
                <Td numeric className="mono">
                  {row.barCount.toLocaleString()}
                </Td>
                <Td className="mono text-xs text-ink-2">
                  {formatDate(row.firstTs)} → {formatDate(row.lastTs)}
                </Td>
                <Td numeric className="mono">
                  {row.estimatedGaps > 0 ? (
                    <span className="text-warn">{row.estimatedGaps.toLocaleString()}</span>
                  ) : (
                    <span className="text-ink-3">0</span>
                  )}
                </Td>
                <Td>
                  <Badge tone="neutral">{isKnownSource(row.source) ? t(`sources.${row.source}`) : row.source}</Badge>
                </Td>
                <Td numeric className="mono text-ink-2">
                  {formatBytes(row.barCount * BYTES_PER_ROW_ESTIMATE)}
                </Td>
                <Td className="text-xs text-ink-2">
                  {row.latestImport ? (
                    <span title={row.latestImport.fileName ?? undefined}>
                      {new Date(row.latestImport.createdAt).toISOString().slice(0, 10)}
                      {row.latestImport.fileName ? ` · ${row.latestImport.fileName}` : ""}
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Td>
                <Td className="relative">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("deleteAria", { symbol: row.symbol, timeframe: row.timeframe })}
                    onClick={() => setDeleteTarget(row)}
                    disabled={!canDelete}
                    title={canDelete ? undefined : t("ownerOnly")}
                  >
                    <Trash2 />
                  </Button>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>

      <DeleteCoverageDialog row={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} />
    </>
  );
}

function DeleteCoverageDialog({
  row,
  onOpenChange,
}: {
  row: CoverageTableRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("backtest");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { toast } = useToast();

  async function handleDelete() {
    if (!row) return;
    setPending(true);
    setError(null);
    const result = await deleteCandles({ symbol: row.symbol, timeframe: row.timeframe as never });
    setPending(false);
    if (result.ok) {
      toast({ title: t("coverage.deletedBars", { count: row.barCount.toLocaleString() }), tone: "neutral" });
      onOpenChange(false);
    } else {
      setError(result.formError ?? t("coverage.couldNotDelete"));
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title={t("coverage.deleteTitle")}
          description={
            row
              ? t("coverage.deleteDescription", {
                  count: row.barCount.toLocaleString(),
                  timeframe: row.timeframe,
                  symbol: row.symbol,
                })
              : undefined
          }
        />
        <DialogBody>
          {error ? (
            <p className="rounded-control border border-loss/35 bg-loss-weak px-2.5 py-2 text-xs text-loss">{error}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} disabled={pending}>
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
