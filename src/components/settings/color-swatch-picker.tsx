"use client";

import { cn } from "@/lib/cn";

/**
 * Ten swatches in the same tonal families as the app's own palette (cobalt,
 * jade, clay, amber — see globals.css) plus enough extra hue spread to tell
 * ten different tags apart at a glance. Tag colour is the one place in the
 * app where an arbitrary hex value is legitimate UI data, not chrome — it's
 * always rendered as a dot/swatch, never as text colour (see AGENTS
 * instructions / docs/JOURNAL.md).
 */
export const TAG_SWATCHES = [
  "#3F57C9", // cobalt
  "#4F8FD1", // sky
  "#2E9E83", // teal
  "#17916A", // jade
  "#96650A", // amber
  "#D3543A", // clay
  "#B23A48", // rose
  "#9C3A6E", // plum
  "#6B7480", // slate
  "#525A66", // charcoal
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function ColorSwatchPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {TAG_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={value.toLowerCase() === c.toLowerCase()}
            onClick={() => onChange(c)}
            className={cn(
              "size-6 shrink-0 rounded-full border-2 transition-[border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              value.toLowerCase() === c.toLowerCase() ? "border-ink" : "border-transparent hover:border-line-strong",
            )}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-4 shrink-0 rounded-full border border-line"
          style={{ background: HEX_RE.test(value) ? value : "transparent" }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#33488F"
          maxLength={7}
          aria-label="Custom hex colour"
          className={cn(
            "mono h-7 w-28 rounded-control border border-line bg-panel px-2 text-xs text-ink outline-none",
            "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-weak",
          )}
        />
      </div>
      {error ? <span className="text-2xs text-loss">{error}</span> : null}
    </div>
  );
}
