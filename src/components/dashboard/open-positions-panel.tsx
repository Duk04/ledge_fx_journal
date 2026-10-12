import { Inbox } from "lucide-react";
import { EmptyState, Badge, DirectionBadge } from "@/components/ui";
import { formatPrice } from "@/lib/metrics/formatters";
import type { OpenTrade } from "@/lib/queries/analytics";

/**
 * Open positions are always "right now" — never scoped by the range picker
 * (a 7-day view shouldn't hide a position that's been open for two weeks).
 */
export function OpenPositionsPanel({ trades }: { trades: OpenTrade[] }) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="size-4" />}
        title="No open positions"
        description="Everything is closed out on this account right now."
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-line-faint">
      {trades.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <DirectionBadge direction={t.direction} />
            <span className="mono truncate text-sm text-ink">{t.symbol}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-2xs text-ink-3">
            {t.stopLoss === null ? <Badge tone="warn">No stop</Badge> : null}
            <span className="mono text-ink-2">
              {t.volumeLots.toFixed(2)} lot @ {formatPrice(t.entryPrice, t.digits)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
