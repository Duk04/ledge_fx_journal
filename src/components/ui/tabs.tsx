"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

/** The hairline lives here, not on the page around it, so a TabsList composes
 * cleanly inside a PanelHeader without doubling up borders. */
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex items-end gap-4 border-b border-line", className)} {...props} />;
}

/**
 * Underline, not a pill: the active tab's indicator is a 2px brand border
 * inset by `-mb-px` so it sits directly on top of the list's hairline instead
 * of floating a couple of pixels above it.
 */
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px border-b-2 border-transparent px-0.5 pb-2 text-sm text-ink-3",
        "transition-[color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:text-ink-2",
        "data-[state=active]:border-brand data-[state=active]:text-ink data-[state=active]:font-medium",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}
