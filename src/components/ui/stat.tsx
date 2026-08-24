import * as React from "react";
import { cn } from "@/lib/cn";
import { Sparkline } from "./sparkline";

/**
 * A single figure with its caption. Deliberately flat — stat tiles sit inside a
 * panel that already has a border, so giving each one its own card would stack
 * three nested outlines for no information gain.
 *
 * `hint` is where the interpretation goes ("needs 38% to break even"), and it
 * matters more than the number: a win rate with nothing to compare it against
 * is trivia.
 */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  spark,
  size = "md",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "profit" | "loss" | "warn";
  spark?: number[];
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="label truncate">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span
          className={cn(
            "mono font-medium tracking-[-0.02em]",
            size === "lg" ? "text-xl" : "text-lg",
            tone === "profit" && "text-profit",
            tone === "loss" && "text-loss",
            tone === "warn" && "text-warn",
            tone === "neutral" && "text-ink",
          )}
        >
          {value}
        </span>
        {spark && spark.length > 1 ? (
          <Sparkline values={spark} width={72} height={22} className="mb-0.5" />
        ) : null}
      </div>
      {hint ? <span className="truncate text-2xs text-ink-3">{hint}</span> : null}
    </div>
  );
}

/**
 * A row of stats separated by hairlines. On narrow screens it wraps into a
 * 2-column grid rather than shrinking the figures to nothing.
 */
export function StatRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-6",
        "[&>*+*]:sm:border-l [&>*+*]:sm:border-line [&>*+*]:sm:pl-4",
        "[&>*:nth-child(3n+1)]:sm:border-l-0 [&>*:nth-child(3n+1)]:sm:pl-0",
        "lg:[&>*:nth-child(3n+1)]:border-l lg:[&>*:nth-child(3n+1)]:pl-4",
        "lg:[&>*:first-child]:border-l-0 lg:[&>*:first-child]:pl-0",
        className,
      )}
      {...props}
    />
  );
}
