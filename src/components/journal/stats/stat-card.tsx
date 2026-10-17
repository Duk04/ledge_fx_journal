import type * as React from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, Tip } from "@/components/ui";

/**
 * One figure on the journal's stat grid: a caption with a "?" that says what
 * the number means, the number, and room on the right for its picture (a
 * gauge, a donut, the trade it came from).
 *
 * Its own card, unlike `Stat` in a `StatRow`: the journal grid mixes figures
 * with pictures of different widths, and the screenshots this page follows
 * give each one a tile. The explanation lives in the tooltip because several
 * of these numbers ("best day % of total profit") are easy to misread.
 */
export function StatCard({
  label,
  help,
  value,
  tone = "neutral",
  detail,
  aside,
  className,
}: {
  label: string;
  help: string;
  value: React.ReactNode;
  tone?: "neutral" | "profit" | "loss";
  /** A line under the figure — counts, the date it happened. */
  detail?: React.ReactNode;
  /** Right-hand side: a Gauge, a Donut, or a few lines of context. */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel className={cn("flex-row items-center justify-between gap-4 p-4", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <span className="flex items-center gap-1.5 text-sm text-ink-2">
          <span className="truncate">{label}</span>
          <Tip label={help}>
            <button
              type="button"
              aria-label={help}
              className="shrink-0 rounded-full text-ink-3 hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <CircleHelp className="size-3.5" aria-hidden />
            </button>
          </Tip>
        </span>
        <span
          className={cn(
            "mono truncate text-xl font-semibold tracking-[-0.02em]",
            tone === "profit" && "text-profit",
            tone === "loss" && "text-loss",
            tone === "neutral" && "text-ink",
          )}
        >
          {value}
        </span>
        {detail ? <span className="truncate text-2xs text-ink-3">{detail}</span> : null}
      </div>
      {aside ? (
        <div className="flex shrink-0 flex-col items-end gap-1 text-right text-2xs text-ink-3">{aside}</div>
      ) : null}
    </Panel>
  );
}

export function toneOf(n: number | null | undefined): "neutral" | "profit" | "loss" {
  if (n === null || n === undefined || Math.abs(n) < 0.005) return "neutral";
  return n > 0 ? "profit" : "loss";
}
