import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui";
import { formatPercent } from "@/lib/metrics/formatters";
import type { DurationBucket } from "@/lib/queries/analytics";
import { HOLDING_LABELS } from "@/lib/queries/analytics/labels";

/**
 * One horizontal bar per holding-time bucket: how many trades were held that
 * long (`count`), or how often they won (`winRate`).
 *
 * Plain boxes rather than a Recharts chart. There are always exactly five
 * rows and the figure is printed beside each bar, so there is nothing to
 * hover for — and a server component needs no client bundle to draw them.
 *
 * In `count` the longest bar is the busiest bucket, so the five compare
 * against each other. In `winRate` a full bar is 100%, and the bar is the
 * loss colour under an even 50% — a bucket of two trades at 0% and one of
 * forty at 45% are both "losing more than winning here", and the count
 * printed next to each says how much weight to give it.
 */
export async function DurationBars({ rows, mode }: { rows: DurationBucket[]; mode: "count" | "winRate" }) {
  const t = await getTranslations("journal.stats");
  if (rows.every((r) => r.trades === 0)) {
    return <EmptyState title={t("durationEmpty")} />;
  }

  const busiest = Math.max(...rows.map((r) => r.trades));

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const decided = row.wins + row.losses;
        const share = mode === "count" ? row.trades / busiest : (row.winRate ?? 0);
        const figure =
          mode === "count" ? String(row.trades) : row.winRate !== null ? formatPercent(row.winRate, 0) : "—";
        return (
          <li key={row.key} className="flex items-center gap-3 text-xs">
            <span className="mono w-14 shrink-0 text-ink-2">{HOLDING_LABELS[row.key]}</span>
            <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-inner bg-inset" aria-hidden>
              <span
                className={cn(
                  "block h-full rounded-inner",
                  mode === "count" ? "bg-ink-3" : (row.winRate ?? 0) >= 0.5 ? "bg-profit" : "bg-loss",
                )}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </span>
            <span className="mono w-12 shrink-0 text-right text-ink">{figure}</span>
            {mode === "winRate" ? (
              <span className="mono w-16 shrink-0 text-right text-2xs text-ink-3">
                {decided > 0 ? t("durationWinDetail", { wins: row.wins, decided }) : ""}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
