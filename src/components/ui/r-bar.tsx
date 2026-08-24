import { cn } from "@/lib/cn";

/**
 * A divergent bar for R multiples, drawn from a centre tick: losses grow left,
 * wins grow right. In a long table this is the fastest way to see the shape of
 * a strategy — a wall of small left bars and a few long right ones is a
 * different business from an even spread, and the numbers alone don't show it.
 *
 * `scale` is the |R| that fills half the track. Pass the same value for every
 * row of a table (usually a rounded-up max) or the bars stop being comparable.
 */
export function RBar({
  value,
  scale = 3,
  width = 68,
  className,
}: {
  value: number | string | null | undefined;
  scale?: number;
  width?: number;
  className?: string;
}) {
  const n = value === null || value === undefined || value === "" ? null : Number(value);

  if (n === null || !Number.isFinite(n)) {
    return (
      <div
        className={cn("relative h-2.5 shrink-0", className)}
        style={{ width }}
        title="No stop loss recorded — R cannot be computed"
      >
        <div className="absolute inset-y-[45%] left-0 right-0 border-t border-dashed border-line-strong" />
      </div>
    );
  }

  const clamped = Math.max(-scale, Math.min(scale, n));
  const pct = (Math.abs(clamped) / scale) * 50;
  const positive = n >= 0;
  const clipped = Math.abs(n) > scale;

  return (
    <div
      className={cn("relative h-2.5 shrink-0", className)}
      style={{ width }}
      title={`${n > 0 ? "+" : ""}${n.toFixed(2)}R`}
    >
      {/* track */}
      <div className="absolute inset-y-0 left-0 right-0 rounded-[1px] bg-inset" />
      {/* centre tick */}
      <div className="absolute inset-y-[-1px] left-1/2 w-px -translate-x-1/2 bg-line-strong" />
      {/* bar */}
      <div
        className={cn(
          "absolute inset-y-[2px] rounded-[1px]",
          positive ? "bg-profit left-1/2" : "bg-loss right-1/2",
        )}
        style={{ width: `${pct}%` }}
      />
      {/* clipped marker: a notch at the end of the track so an outlier reads as
          "off the scale" instead of silently maxing out */}
      {clipped ? (
        <div
          className={cn(
            "absolute inset-y-0 w-[3px]",
            positive ? "right-0 bg-profit" : "left-0 bg-loss",
          )}
        />
      ) : null}
    </div>
  );
}
