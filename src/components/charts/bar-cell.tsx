import { cn } from "@/lib/cn";

/**
 * An in-table horizontal bar for a breakdown row's net P&L. Same divergent
 * from-the-centre construction as `RBar` (src/components/ui/r-bar.tsx) so a
 * reader who has already learned that visual language from the trades table
 * doesn't have to learn a second one here — losses grow left, wins grow
 * right, `scale` is the column's largest |value| so every row in one table
 * is comparable against the others.
 *
 * No hooks, so this renders fine from a server component — only the actual
 * Recharts charts in this directory need to be client components.
 */
export function BarCell({
  value,
  scale,
  width = 96,
  className,
}: {
  value: number;
  /** The largest |value| across the column this cell belongs to. Pass the same value for every row or the bars stop being comparable. */
  scale: number;
  width?: number;
  className?: string;
}) {
  const safeScale = scale > 0 ? scale : 1;
  const pct = Math.min(100, (Math.abs(value) / safeScale) * 50);
  const positive = value >= 0;

  return (
    <div className={cn("relative h-2.5 shrink-0", className)} style={{ width }}>
      {/* track */}
      <div className="absolute inset-y-0 left-0 right-0 rounded-[1px] bg-inset" />
      {/* centre tick */}
      <div className="absolute inset-y-[-1px] left-1/2 w-px -translate-x-1/2 bg-line-strong" />
      {/* bar */}
      <div
        className={cn("absolute inset-y-[2px] rounded-[1px]", positive ? "bg-profit left-1/2" : "bg-loss right-1/2")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
