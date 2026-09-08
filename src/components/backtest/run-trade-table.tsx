import { DataTable, Th, Td, TableEmpty } from "@/components/ui/table";
import { DirectionBadge, SessionBadge } from "@/components/ui/badge";
import { Money, Pips, RValue } from "@/components/ui/value";
import { RBar } from "@/components/ui/r-bar";
import { formatPrice } from "@/lib/metrics/formatters";
import type { RunTradeRow } from "@/lib/queries/backtests";

/** Trades beyond this are still counted in every stat on the page (getRun
 * summarizes ALL of a run's trades) — this cap only bounds how many rows
 * the table itself renders, so a strategy that traded every bar of a
 * 500k-bar run doesn't ship a five-figure table to the browser. */
const MAX_ROWS = 300;

export function RunTradeTable({ trades, currency }: { trades: RunTradeRow[]; currency: string }) {
  const shown = trades.slice(0, MAX_ROWS);
  const scale =
    Math.max(1, ...trades.map((t) => (t.rMultiple !== null ? Math.abs(Number(t.rMultiple)) : 0))) || 3;

  return (
    <>
      <DataTable>
        <thead>
          <tr>
            <Th>Opened</Th>
            <Th>Dir</Th>
            <Th numeric>Entry → Exit</Th>
            <Th numeric>Lots</Th>
            <Th numeric>Pips</Th>
            <Th numeric>Net P&L</Th>
            <Th numeric>R</Th>
            <Th aria-label="R, drawn to scale" />
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => {
            const openedAt = new Date(t.openedAt);
            return (
              <tr key={t.id}>
                <Td>
                  <div className="mono flex flex-col text-xs leading-tight">
                    <span className="text-ink">
                      {openedAt.toLocaleDateString(undefined, { month: "short", day: "2-digit" })}
                    </span>
                    <span className="flex items-center gap-1 text-ink-3">
                      {openedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      <SessionBadge session={t.marketSession} />
                    </span>
                  </div>
                </Td>
                <Td>
                  <DirectionBadge direction={t.direction} />
                </Td>
                <Td numeric>
                  {formatPrice(Number(t.entryPrice), t.digits)}
                  <span className="text-ink-3"> → </span>
                  {t.exitPrice !== null ? formatPrice(Number(t.exitPrice), t.digits) : <span className="text-ink-3">—</span>}
                </Td>
                <Td numeric>{Number(t.volumeLots).toFixed(2)}</Td>
                <Td numeric>
                  <Pips value={t.pips} />
                </Td>
                <Td numeric>
                  <Money value={t.netPnl} currency={currency} />
                </Td>
                <Td numeric>
                  <RValue value={t.rMultiple} />
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <RBar value={t.rMultiple} scale={scale} />
                  </div>
                </Td>
              </tr>
            );
          })}
          {trades.length === 0 ? <TableEmpty colSpan={8}>No trades in this run.</TableEmpty> : null}
        </tbody>
      </DataTable>
      {trades.length > MAX_ROWS ? (
        <p className="px-3 py-2 text-2xs text-ink-3">
          Showing the first {MAX_ROWS} of {trades.length} trades — every one of them is still counted in the stats
          above.
        </p>
      ) : null}
    </>
  );
}
