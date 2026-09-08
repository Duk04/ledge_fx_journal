"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";

/** The `.scroll-x` + `.data-table` wrapper every table in the app should
 * start from — the CSS classes do the actual styling (see globals.css); this
 * just supplies the composition so nobody re-types the wrapper div. */
export function DataTable({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="scroll-x">
      <table className={cn("data-table", className)} {...props} />
    </div>
  );
}

type SortDirection = "asc" | "desc" | false;

export function Th({
  className,
  numeric,
  sortable,
  sortDirection = false,
  children,
  ...props
}: React.ComponentProps<"th"> & {
  numeric?: boolean;
  sortable?: boolean;
  sortDirection?: SortDirection;
}) {
  return (
    <th
      data-numeric={numeric ? "" : undefined}
      aria-sort={
        sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : sortable ? "none" : undefined
      }
      className={cn(sortable && "group/th p-0", className)}
      {...props}
    >
      {sortable ? <div className={cn(numeric && "flex justify-end")}>{children}</div> : children}
    </th>
  );
}

/** The sort-toggle button that goes inside a sortable `<Th>`. Its chevron is
 * invisible until the column is hovered or already the active sort — a
 * header row of six permanently-visible chevrons is just noise. */
export function ColumnHeader({
  className,
  numeric,
  sortDirection = false,
  children,
  ...props
}: React.ComponentProps<"button"> & { numeric?: boolean; sortDirection?: SortDirection }) {
  const Icon = sortDirection === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      className={cn("flex h-full w-full items-center gap-1 px-3 py-0", numeric && "flex-row-reverse", className)}
      {...props}
    >
      <span>{children}</span>
      <Icon
        className={cn(
          "size-3 shrink-0 text-ink-3",
          sortDirection ? "opacity-100" : "opacity-0 group-hover/th:opacity-100",
        )}
        aria-hidden
      />
    </button>
  );
}

export function Td({ className, numeric, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return <td data-numeric={numeric ? "" : undefined} className={className} {...props} />;
}

/**
 * A row whose whole area navigates. The link lives in the first cell but is
 * absolutely positioned against the row (the `tr` is the positioned
 * ancestor, so `inset-0` spans every cell, not just the first). It stays a
 * real, focusable link — labelled by the first cell's own text — rather than
 * `aria-hidden`, so keyboard and screen-reader users get the same row-level
 * navigation as a mouse click.
 *
 * It is deliberately the first thing in the DOM, which puts it lowest in
 * paint order: plain cell content paints over it automatically. Any cell
 * that needs its own click target (a button, a dropdown trigger) just needs
 * `relative` on that element to lift it above the overlay explicitly.
 */
export function TrLink({ href, className, children, ...props }: React.ComponentProps<"tr"> & { href: string }) {
  const labelId = React.useId();
  return (
    <tr className={cn("relative", className)} {...props}>
      {React.Children.map(children, (child, i) =>
        i === 0 && React.isValidElement<React.ComponentProps<"td">>(child)
          ? React.cloneElement(child, {
              children: (
                <>
                  <Link href={href} className="absolute inset-0" aria-labelledby={labelId} />
                  <span id={labelId} className="relative">
                    {child.props.children}
                  </span>
                </>
              ),
            })
          : child,
      )}
    </tr>
  );
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="!h-32 text-center text-xs text-ink-3">
        {children}
      </td>
    </tr>
  );
}
