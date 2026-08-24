"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[1.125rem] w-8 shrink-0 items-center rounded-[var(--radius-pill)] bg-inset",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "data-[state=checked]:bg-brand",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-3.5 translate-x-0.5 rounded-full border border-line-strong bg-panel",
          "transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "data-[state=checked]:translate-x-[1.1rem]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
