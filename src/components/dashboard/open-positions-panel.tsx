import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState, Badge, DirectionBadge } from "@/components/ui";
import { formatPrice } from "@/lib/metrics/formatters";
import type { OpenTrade } from "@/lib/queries/analytics";

/**
 * Open positions are always "right now" — never scoped by the range picker
 * (a 7-day view shouldn't hide a position that's been open for two weeks).
 */
export function OpenPositionsPanel({ trades }: { trades: OpenTrade[] }) {
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
            {trade.stopLoss === null ? <Badge tone="warn">{t("noStop")}</Badge> : null}
            <span className="mono text-ink-2">
              {t("lotsAt", { lots: trade.volumeLots.toFixed(2), price: formatPrice(trade.entryPrice, trade.digits) })}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
