import { format } from "date-fns";
import { DataTable, Th, Td, TrLink, TableEmpty } from "@/components/ui";
import { DirectionBadge } from "@/components/ui";
import { Money, RValue } from "@/components/ui";
import { RBar } from "@/components/ui";
import type { RecentTrade } from "@/lib/queries/analytics";

/**
 * Last 10 trades, independent of the range picker (see analytics.ts's
 * doc-comment: this answers "what's happening right now", not "how did the
 * selected window go"). Whole rows navigate to the trade detail page.
 */
export function RecentTradesTable({ trades }: { trades: RecentTrade[] }) {
  const scale = Math.max(1, ...trades.map((t) => Math.abs(t.rMultiple ?? 0)));

  return (
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
          <TableEmpty colSpan={5}>No trades yet.</TableEmpty>
        ) : (
          trades.map((t) => (
            <TrLink key={t.id} href={`/trades/${t.id}`}>
              <Td>{format(new Date(t.openedAt), "MMM d")}</Td>
              <Td className="mono">{t.symbol}</Td>
              <Td>
                <DirectionBadge direction={t.direction} />
              </Td>
              <Td numeric>
                <div className="flex items-center justify-end gap-2">
                  <RBar value={t.rMultiple} scale={scale} width={44} />
                  <RValue value={t.rMultiple} />
                </div>
              </Td>
              <Td numeric>
                <Money value={t.netPnl} signed />
              </Td>
            </TrLink>
          ))
        )}
      </tbody>
    </DataTable>
  );
}
