import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "profit" | "loss" | "warn" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-inset text-ink-2 border-transparent",
  brand: "bg-brand-weak text-brand border-brand-line",
  profit: "bg-profit-weak text-profit border-profit/25",
  loss: "bg-loss-weak text-loss border-loss/25",
  warn: "bg-warn-weak text-warn border-warn/25",
  outline: "bg-transparent text-ink-2 border-line",
};

export function Badge({ tone = "neutral", className, ...props }: React.ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.15rem] shrink-0 items-center gap-1 rounded-inner border px-1.5",
        "text-2xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Direction. LONG/SHORT rather than an arrow glyph: at 11px an arrow is a
 * smudge, and traders read the words faster anyway.
 *
 * Neutral, not green/red. It used to be painted in the profit/loss tones,
 * which broke rule 3 of docs/DESIGN-SYSTEM.md (colour is reserved for money)
 * in the worst way: a SHORT that made money showed a red badge beside a
 * green P&L, and the eye reads the badge first.
 */
export function DirectionBadge({ direction }: { direction: "LONG" | "SHORT" }) {
  return (
    <Badge tone="outline" className="mono w-[3.4rem] justify-center tracking-[0.06em]">
      {direction}
    </Badge>
  );
}

/**
 * Market session as a two-letter code. Full words don't fit a dense table and
 * emoji would be worse; the codes are learned in about four seconds and the
 * title attribute carries the long form.
 */
const SESSION_CODES: Record<string, { code: string; name: string }> = {
  SYDNEY: { code: "SY", name: "Sydney" },
  TOKYO: { code: "TK", name: "Tokyo" },
  LONDON: { code: "LN", name: "London" },
  NEW_YORK: { code: "NY", name: "New York" },
  NEWYORK: { code: "NY", name: "New York" },
  OVERLAP: { code: "OV", name: "London / New York overlap" },
  OFFHOURS: { code: "··", name: "Outside the main sessions" },
  OFF_HOURS: { code: "··", name: "Outside the main sessions" },
};

export function SessionBadge({ session }: { session: string | null | undefined }) {
  if (!session) return <span className="text-ink-3">—</span>;
  const meta = SESSION_CODES[session] ?? { code: session.slice(0, 2).toUpperCase(), name: session };
  return (
    <span
      title={meta.name}
      className={cn(
        "mono inline-flex h-[1.15rem] w-[1.9rem] items-center justify-center rounded-inner",
        "border border-line bg-panel-sunken text-2xs tracking-[0.04em] text-ink-2",
        meta.code === "OV" && "border-brand-line bg-brand-weak text-brand",
      )}
    >
      {meta.code}
    </span>
  );
}

/**
 * A user tag. The dot carries the colour so the text stays legible on both
 * themes no matter what colour the user picked.
 */
export function TagChip({
  name,
  color,
  onRemove,
  className,
}: {
  name: string;
  color?: string | null;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.35rem] shrink-0 items-center gap-1.5 rounded-inner border border-line",
        "bg-panel-sunken px-1.5 text-xs text-ink-2",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color || "var(--ink-3)" }} />
      <span className="max-w-[10rem] truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="-mr-0.5 grid size-3.5 place-items-center rounded-[2px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}
