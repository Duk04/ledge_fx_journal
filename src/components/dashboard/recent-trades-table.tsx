import { useTranslations } from "next-intl";
import { DataTable, Th, Td, TrLink, TableEmpty } from "@/components/ui";
import { DirectionBadge } from "@/components/ui";
import { Money, RValue } from "@/components/ui";
import { RBar } from "@/components/ui";
import { formatInZone } from "@/lib/metrics/formatters";
import type { RecentTrade } from "@/lib/queries/analytics";

/**
 * Last 10 trades, independent of the range picker (see analytics.ts's
 * doc-comment: this answers "what's happening right now", not "how did the
 * selected window go"). Whole rows navigate to the trade detail page.
 */
export function RecentTradesTable({
  trades,
  currency,
  timezone,
}: {
  trades: RecentTrade[];
  currency: string;
  timezone: string;
}) {
  const t = useTranslations("dashboard.table");
  const scale = Math.max(1, ...trades.map((t) => Math.abs(t.rMultiple ?? 0)));

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>{t("date")}</Th>
          <Th>{t("symbol")}</Th>
          <Th>{t("dir")}</Th>
          <Th numeric>{t("r")}</Th>
          <Th numeric>{t("netPnl")}</Th>
        </tr>
      </thead>
      <tbody>
        {trades.length === 0 ? (
          <TableEmpty colSpan={5}>{t("noTradesYet")}</TableEmpty>
        ) : (
          trades.map((t) => (
            <TrLink key={t.id} href={`/trades/${t.id}`}>
              <Td>{formatInZone(t.openedAt, timezone, "MMM d")}</Td>
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
                <Money value={t.netPnl} currency={currency} signed />
              </Td>
            </TrLink>
          ))
        )}
      </tbody>
    </DataTable>
  );
}
