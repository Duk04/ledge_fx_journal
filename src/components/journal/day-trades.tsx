import { getTranslations } from "next-intl/server";
import { DataTable, Th, Td, TrLink, DirectionBadge, Badge, Money, RValue } from "@/components/ui";
import type { DayTrade } from "@/lib/queries/journal";

/** Read-only list of the trades that landed on one journal day, linking out to each trade. */
export async function DayTrades({ trades, currency }: { trades: DayTrade[]; currency: string }) {
  const t = await getTranslations("journal.trades");
  if (trades.length === 0) {
    return <p className="px-3 py-8 text-center text-xs text-ink-3">{t("empty")}</p>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>{t("symbol")}</Th>
          <Th>{t("direction")}</Th>
          <Th>{t("status")}</Th>
          <Th numeric>{t("netPnl")}</Th>
          <Th numeric>{t("r")}</Th>
        </tr>
      </thead>
      <tbody>
        {trades.map((tr) => (
          <TrLink key={tr.id} href={`/trades/${tr.id}`}>
            <Td className="font-medium text-ink">{tr.symbol}</Td>
            <Td>
              <DirectionBadge direction={tr.direction} />
            </Td>
            <Td>
              <Badge tone={tr.status === "OPEN" ? "warn" : "neutral"}>{tr.status}</Badge>
            </Td>
            <Td numeric>
              <Money value={tr.netPnl} currency={currency} signed />
            </Td>
            <Td numeric>
              <RValue value={tr.rMultiple} />
            </Td>
          </TrLink>
        ))}
      </tbody>
    </DataTable>
  );
}
