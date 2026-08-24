"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/** One provider at the root keeps every tooltip in the app on the same open
 * delay, so hovering across a toolbar doesn't re-trigger the 250ms wait on
 * every icon button. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-56 rounded-[var(--radius-control)] border border-line bg-panel-raised px-2 py-1 text-2xs text-ink shadow-overlay",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/** The 95% case: a plain text label on hover/focus. `<Tip label="...">child</Tip>`
 * — reach for the primitives directly only when the content needs markup. */
export function Tip({
  label,
  children,
  side = "top",
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  if (!label) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
