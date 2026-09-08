import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The one container in the system. Defined by a hairline and a surface step —
 * no shadow, because nothing on the page is floating. Shadows belong to
 * overlays only (see dialog / dropdown).
 */
export function Panel({ className, flush, ...props }: React.ComponentProps<"section"> & { flush?: boolean }) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--radius-panel)] border border-line bg-panel",
        !flush && "overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Panel header. The title sits left, controls right, and the whole thing is
 * exactly one compact row tall so a column of panels lines up across the grid.
 */
export function PanelHeader({
  title,
  caption,
  actions,
  className,
  children,
  ...props
}: React.ComponentProps<"header"> & {
  title?: React.ReactNode;
  caption?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header
      className={cn("flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-3", className)}
      {...props}
    >
      {children ?? (
        <div className="flex min-w-0 items-baseline gap-2">
          {title ? <h2 className="truncate text-sm font-semibold text-ink">{title}</h2> : null}
          {caption ? <span className="truncate text-xs text-ink-3">{caption}</span> : null}
        </div>
      )}
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, padded = true, ...props }: React.ComponentProps<"div"> & { padded?: boolean }) {
  return <div className={cn("min-w-0 flex-1", padded && "p-3", className)} {...props} />;
}

export function PanelFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel-sunken px-3 py-2 text-xs text-ink-2",
        className,
      )}
      {...props}
    />
  );
}

/** Uppercase mono micro-label. The connective tissue of the whole interface. */
export function Label2({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("label", className)} {...props} />;
}

/** A page-level section heading with an optional right-hand slot. */
export function SectionHead({
  title,
  hint,
  actions,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
