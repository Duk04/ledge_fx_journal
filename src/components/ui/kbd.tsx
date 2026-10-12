"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A keyboard hint. Takes its colour from the surrounding text (border and
 * fill are fractions of `currentColor`), so the same component reads on a
 * primary button, a panel, or a tooltip without a per-place colour — which is
 * what the hand-rolled `bg-black/15` it replaced could not do in dark mode.
 */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded-inner border border-current/25 bg-current/10 px-1 font-sans text-2xs leading-none font-normal",
        className,
      )}
      {...props}
    />
  );
}

const subscribe = () => () => {};

/** "⌘" on Apple platforms, "Ctrl" elsewhere. Server render and first paint
 * say "Ctrl"; the hydrated client corrects it — no hydration mismatch, since
 * useSyncExternalStore uses the server snapshot until then. */
export function useModKey(): "⌘" | "Ctrl" {
  return React.useSyncExternalStore(
    subscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}
