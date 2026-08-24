import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The one tooltip shell every chart in this directory renders instead of
 * Recharts' default tooltip — per the house rule, nothing here uses stock
 * tooltip/legend styling. Matches the app's overlay recipe exactly:
 * `bg-panel-raised border-line shadow-overlay text-xs`.
 */
export function ChartTooltipShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "min-w-36 rounded-[var(--radius-control)] border border-line bg-panel-raised px-2.5 py-1.5 text-xs text-ink shadow-overlay",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ChartTooltipTitle({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-2xs text-ink-3">{children}</div>;
}

export function ChartTooltipRow({
  label,
  value,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "profit" | "loss" | "warn";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      <span
        className={cn(
          "mono tabular-nums",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </span>
    </div>
  );
}
