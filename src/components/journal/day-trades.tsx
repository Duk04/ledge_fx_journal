import { DataTable, Th, Td, TrLink, DirectionBadge, Badge, Money, RValue } from "@/components/ui";
import type { DayTrade } from "@/lib/queries/journal";

/** Read-only list of the trades that landed on one journal day, linking out to each trade. */
export function DayTrades({ trades, currency }: { trades: DayTrade[]; currency: string }) {
  if (trades.length === 0) {
    return <p className="px-3 py-8 text-center text-xs text-ink-3">No trades landed on this day.</p>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Symbol</Th>
          <Th>Direction</Th>
          <Th>Status</Th>
          <Th numeric>Net P&amp;L</Th>
          <Th numeric>R</Th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <TrLink key={t.id} href={`/trades/${t.id}`}>
            <Td className="font-medium text-ink">{t.symbol}</Td>
            <Td>
              <DirectionBadge direction={t.direction} />
            </Td>
            <Td>
              <Badge tone={t.status === "OPEN" ? "warn" : "neutral"}>{t.status}</Badge>
            </Td>
            <Td numeric>
              <Money value={t.netPnl} currency={currency} signed />
            </Td>
            <Td numeric>
              <RValue value={t.rMultiple} />
            </Td>
          </TrLink>
        ))}
      </tbody>
    </DataTable>
  );
}
