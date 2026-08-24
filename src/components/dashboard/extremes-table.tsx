import { format } from "date-fns";
import { DataTable, Th, Td, TableEmpty, TrLink, DirectionBadge, Money, RValue } from "@/components/ui";
import type { TradeExtreme } from "@/lib/queries/analytics";

/** The 5 biggest winners or losers — same shape for both, `title` just picks the copy. */
export function ExtremesTable({
  title,
  trades,
  currency,
}: {
  title: string;
  trades: TradeExtreme[];
  currency: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-3 py-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <DataTable>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Symbol</Th>
            <Th>Dir</Th>
            <Th numeric>R</Th>
            <Th numeric>Net P&L</Th>
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <TableEmpty colSpan={5}>None in this range.</TableEmpty>
          ) : (
            trades.map((t) => (
              <TrLink key={t.id} href={`/trades/${t.id}`}>
                <Td>{format(new Date(t.openedAt), "MMM d")}</Td>
                <Td className="mono">{t.symbol}</Td>
                <Td>
                  <DirectionBadge direction={t.direction} />
                </Td>
                <Td numeric>
                  <RValue value={t.rMultiple} />
                </Td>
                <Td numeric>
                  <Money value={t.netPnl} currency={currency} signed />
                </Td>
              </TrLink>
            ))
          )}
        </tbody>
      </DataTable>
    </div>
  );
}
