import { cn } from "@/lib/cn";
import { DataTable, Th, Td, TableEmpty, Money, Percent, RValue } from "@/components/ui";
import { BarCell } from "@/components/charts/bar-cell";
import type { BreakdownRow } from "@/lib/queries/analytics";

/**
 * One table per breakdown dimension (symbol / setup tag / session /
 * direction / plan-followed). Rows arrive pre-sorted by net P&L descending
 * (see analytics.ts), so the LAST row is always the weakest performer in
 * this dimension — its row header gets a loss tint so the problem area is
 * findable in a glance instead of requiring the reader to scan every row.
 */
export function BreakdownTable({
  rows,
  currency,
  keyLabel,
}: {
  rows: BreakdownRow[];
  currency: string;
  /** Column header for the dimension's own key, e.g. "Symbol", "Session". */
  keyLabel: string;
}) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.netPnl)));
  const weakestKey = rows.length > 1 ? rows[rows.length - 1].key : null;

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>{keyLabel}</Th>
          <Th numeric>Count</Th>
          <Th numeric>Net P&L</Th>
          <Th numeric>Win rate</Th>
          <Th numeric>PF</Th>
          <Th numeric>Exp. R</Th>
          <Th numeric>Avg R</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={7}>No trades in this range.</TableEmpty>
        ) : (
          rows.map((r) => (
            <tr key={r.key}>
              <Td className={cn(r.key === weakestKey && "bg-loss-weak")}>
                <span className="truncate">{r.label}</span>
              </Td>
              <Td numeric>{r.count}</Td>
              <Td numeric>
                <div className="flex items-center justify-end gap-2">
                  <BarCell value={r.netPnl} scale={maxAbs} width={64} />
                  <Money value={r.netPnl} currency={currency} signed />
                </div>
              </Td>
              <Td numeric>
                {r.winRate === null ? <span className="text-ink-3">—</span> : <Percent value={r.winRate} />}
              </Td>
              <Td numeric>
                {r.profitFactor === null ? <span className="text-ink-3">—</span> : r.profitFactor.toFixed(2)}
              </Td>
              <Td numeric>
                {r.expectancyR === null ? <span className="text-ink-3">—</span> : <RValue value={r.expectancyR} />}
              </Td>
              <Td numeric>
                {r.averageR === null ? <span className="text-ink-3">—</span> : <RValue value={r.averageR} />}
              </Td>
            </tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}
