"use client";

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/cn";

/**
 * Single-select segmented control — date ranges, density switches. The track
 * is sunken and each item raises to `bg-panel` when selected, the same trick
 * a physical switch uses: the thing that's "on" sits proud of the surface.
 */
export function Segmented({
  className,
  ...props
}: Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, "type">) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-panel-sunken p-[2px]",
        className,
      )}
      {...props}
    />
  );
}

export function SegmentedItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "flex h-7 items-center justify-center rounded-[3px] border border-transparent px-2.5 text-xs text-ink-2",
        "transition-[background-color,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:text-ink",
        "data-[state=on]:border-line data-[state=on]:bg-panel data-[state=on]:text-ink",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}
