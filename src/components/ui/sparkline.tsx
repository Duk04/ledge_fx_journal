import { cn } from "@/lib/cn";

/**
 * A pure-SVG sparkline. No chart library: these render in tables, stat tiles
 * and the account switcher, and a Recharts instance per row is absurd.
 *
 * The final point gets a dot, because the thing a reader wants from a
 * sparkline is "where did it end up".
 */
export function Sparkline({
  values,
  width = 96,
  height = 26,
  className,
  area = true,
  tone = "auto",
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  area?: boolean;
  /** "auto" colours by whether the series ended above where it started. */
  tone?: "auto" | "profit" | "loss" | "neutral" | "brand";
}) {
  if (!values.length) {
    return <div className={cn("shrink-0", className)} style={{ width, height }} aria-hidden />;
  }

  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;

  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const fill = `${line} L${pts[pts.length - 1][0].toFixed(2)},${height} L${pts[0][0].toFixed(2)},${height} Z`;

  const resolved = tone === "auto" ? (values[values.length - 1] >= values[0] ? "profit" : "loss") : tone;
  const stroke =
    resolved === "profit"
      ? "var(--profit)"
      : resolved === "loss"
        ? "var(--loss)"
        : resolved === "brand"
          ? "var(--brand)"
          : "var(--ink-3)";

  const gid = `spark-${resolved}-${values.length}-${Math.round(min)}-${Math.round(max)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
      role="img"
      aria-hidden
    >
      {area ? (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fill} fill={`url(#${gid})`} />
        </>
      ) : null}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="1.9" fill={stroke} />
    </svg>
  );
}
