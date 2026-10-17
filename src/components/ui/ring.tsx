import { cn } from "@/lib/cn";

/**
 * Two-part proportion marks for stat cards: a full ring (`Donut`) and a
 * half ring opening downwards (`Gauge`). Pure SVG for the same reason as
 * Sparkline — they sit inside stat cards, and a chart library per card is
 * absurd.
 *
 * Both draw exactly two parts, `positive` in profit and `negative` in loss,
 * because every place they are used asks one question: how much of this
 * went my way (wins vs losses, gross profit vs gross loss, long vs short
 * when given brand/neutral tones). Each part is labelled for screen readers
 * by the card around it, so the SVG itself is aria-hidden.
 *
 * With nothing on either side the ring is drawn empty, in the hairline
 * colour, rather than as a misleading 50/50.
 */

type Tone = "profit" | "loss" | "brand" | "neutral";

const STROKE: Record<Tone, string> = {
  profit: "var(--profit)",
  loss: "var(--loss)",
  brand: "var(--brand)",
  neutral: "var(--ink-3)",
};

interface RingProps {
  positive: number;
  negative: number;
  size?: number;
  thickness?: number;
  positiveTone?: Tone;
  negativeTone?: Tone;
  className?: string;
}

function share(positive: number, negative: number): number | null {
  const total = Math.abs(positive) + Math.abs(negative);
  return total > 0 ? Math.abs(positive) / total : null;
}

export function Donut({
  positive,
  negative,
  size = 72,
  thickness = 8,
  positiveTone = "profit",
  negativeTone = "loss",
  className,
}: RingProps) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const p = share(positive, negative);
  // A hairline gap between the two parts, so a 98/2 split still shows two.
  const gap = p !== null && p > 0 && p < 1 ? Math.min(3, c * 0.01) : 0;
  const posLen = p === null ? 0 : Math.max(0, p * c - gap);
  const negLen = p === null ? 0 : Math.max(0, (1 - p) * c - gap);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("shrink-0", className)} aria-hidden>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`} fill="none" strokeWidth={thickness}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" />
        {p !== null && negLen > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={STROKE[negativeTone]}
            strokeDasharray={`${negLen} ${c - negLen}`}
            strokeDashoffset={-(p * c)}
          />
        ) : null}
        {p !== null && posLen > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={STROKE[positiveTone]}
            strokeDasharray={`${posLen} ${c - posLen}`}
          />
        ) : null}
      </g>
    </svg>
  );
}

/** A half ring: `negative` from the left end, `positive` from the right. */
export function Gauge({
  positive,
  negative,
  size = 96,
  thickness = 8,
  positiveTone = "profit",
  negativeTone = "loss",
  className,
}: RingProps) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const half = Math.PI * r;
  const p = share(positive, negative);
  const gap = p !== null && p > 0 && p < 1 ? 2 : 0;
  const negLen = p === null ? 0 : Math.max(0, (1 - p) * half - gap / 2);
  const posLen = p === null ? 0 : Math.max(0, p * half - gap / 2);
  // Left end, over the top, to the right end.
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const height = size / 2 + thickness / 2;

  return (
    <svg
      width={size}
      height={height}
      viewBox={`0 0 ${size} ${height}`}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <g fill="none" strokeWidth={thickness} strokeLinecap="butt">
        <path d={arc} stroke="var(--line)" />
        {negLen > 0 ? <path d={arc} stroke={STROKE[negativeTone]} strokeDasharray={`${negLen} ${half * 2}`} /> : null}
        {posLen > 0 ? (
          <path d={arc} stroke={STROKE[positiveTone]} strokeDasharray={`0 ${half - posLen} ${posLen} ${half}`} />
        ) : null}
      </g>
    </svg>
  );
}
