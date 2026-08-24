import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Percent } from "@/components/ui";
import type { OverviewData } from "@/lib/queries/analytics";

/**
 * Habits, not P&L — the three numbers a trader is most tempted to look
 * away from. "Trades without a stop loss" in particular is surfaced as a
 * plain count (not buried as a footnote), because it's a genuine risk-of-
 * ruin signal that a win-rate/profit-factor summary would never show.
 */
export function DisciplinePanel({ discipline }: { discipline: OverviewData["discipline"] }) {
  const { tradeCount, planFollowedRate, noStopCount, noStopRate, avgEmotion } = discipline;

  if (tradeCount === 0) {
    return <p className="px-3 py-4 text-xs text-ink-3">No trades in this range to score discipline on.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-line-faint">
      <Row
        label="Plan followed"
        value={planFollowedRate === null ? "—" : <Percent value={planFollowedRate} />}
        hint={planFollowedRate === null ? "not recorded on these trades" : undefined}
      />
      <Row
        label="No stop loss"
        value={`${noStopCount} / ${tradeCount}`}
        hint={noStopRate !== null ? `${(noStopRate * 100).toFixed(0)}% of trades taken naked` : undefined}
        tone={noStopCount > 0 ? "warn" : "neutral"}
      />
      <Row
        label="Avg. emotion"
        value={avgEmotion === null ? "—" : avgEmotion.toFixed(1)}
        hint={avgEmotion === null ? "not recorded" : "1 (calm) – 5 (extreme)"}
      />
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-ink-2">{label}</span>
        {hint ? <span className="truncate text-2xs text-ink-3">{hint}</span> : null}
      </div>
      <span className={cn("mono shrink-0 text-sm font-medium", tone === "warn" && "text-warn")}>{value}</span>
    </div>
  );
}
