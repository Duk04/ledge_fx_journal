import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState, Badge, DirectionBadge } from "@/components/ui";
import { formatMoney, formatPrice } from "@/lib/metrics/formatters";
import type { OpenTrade } from "@/lib/queries/analytics";

/**
 * Open positions are always "right now" — never scoped by the range picker
 * (a 7-day view shouldn't hide a position that's been open for two weeks).
 */
export function OpenPositionsPanel({ trades, currency }: { trades: OpenTrade[]; currency: string }) {
  const t = useTranslations("dashboard.openPositions");
  if (trades.length === 0) {
    return (
      <EmptyState icon={<Inbox className="size-4" />} title={t("emptyTitle")} description={t("emptyDescription")} />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-line-faint">
      {trades.map((trade) => (
        <li key={trade.id} className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <DirectionBadge direction={trade.direction} />
            <span className="mono truncate text-sm text-ink">{trade.symbol}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-2xs text-ink-3">
            {trade.hasDefinedRisk ? null : <Badge tone="warn">{t("noStop")}</Badge>}
            <span className="mono text-ink-2">
              {trade.entryPrice !== null && trade.volumeLots !== null
                ? t("lotsAt", { lots: trade.volumeLots.toFixed(2), price: formatPrice(trade.entryPrice, trade.digits) })
                : t("riskPlan", {
                    risk: formatMoney(trade.plannedRisk, currency),
                    rr: trade.plannedRR !== null ? `1:${trade.plannedRR}` : "—",
                  })}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
