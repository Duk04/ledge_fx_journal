"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
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

const SOURCE_LABEL: Record<string, string> = {
  MT5_CSV: "MT5 CSV",
  GENERIC_CSV: "Generic CSV",
  API: "API",
};

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

export function CoverageTable({ rows }: { rows: CoverageTableRow[] }) {
  const [deleteTarget, setDeleteTarget] = React.useState<CoverageTableRow | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No market data imported yet"
        description={
          <>
            Export bars from MT5 — <strong>View → Symbols</strong>, pick a symbol, open its <strong>Bars</strong> tab and
            export, or use <strong>Tools → History Center</strong> — then import the CSV below.
          </>
        }
      />
    );
  }

  return (
    <>
      <DataTable>
        <thead>
          <tr>
            <Th>Symbol</Th>
            <Th>Timeframe</Th>
            <Th numeric>Bars</Th>
            <Th>First → last</Th>
            <Th numeric>Gaps (est.)</Th>
            <Th>Source</Th>
            <Th numeric>Storage (est.)</Th>
            <Th>Latest import</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={9}>Nothing here yet.</TableEmpty>
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
                  <Badge tone="neutral">{SOURCE_LABEL[row.source] ?? row.source}</Badge>
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
                    aria-label={`Delete ${row.symbol} ${row.timeframe} data`}
                    onClick={() => setDeleteTarget(row)}
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
      toast({ title: `Deleted ${row.barCount.toLocaleString()} bars.`, tone: "neutral" });
      onOpenChange(false);
    } else {
      setError(result.formError ?? "Could not delete this data.");
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title="Delete market data"
          description={
            row
              ? `Permanently delete all ${row.barCount.toLocaleString()} ${row.timeframe} bars for ${row.symbol}? Any backtest that depends on this range will stop working.`
              : undefined
          }
        />
        <DialogBody>
          {error ? (
            <p className="rounded-[var(--radius-control)] border border-loss/35 bg-loss-weak px-2.5 py-2 text-xs text-loss">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} disabled={pending}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
