import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Page frame. Every route uses this so the gutter, max width and vertical
 * rhythm are decided in one place — the fastest way to make an app look
 * unconsidered is to let each page pick its own padding.
 *
 * There is no max-width on the content by default: this is a data tool, and a
 * table that stops at 1100px on a 27" monitor wastes the screen the user bought
 * precisely for this. Prose-ish pages opt in with `width="reading"`.
 */
export function Page({
  className,
  width = "full",
  ...props
}: React.ComponentProps<"div"> & { width?: "full" | "reading" }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-4 p-3 sm:p-4 lg:p-5",
        width === "reading" && "mx-auto w-full max-w-3xl",
        className,
      )}
      {...props}
    />
  );
}

/** A 12-column grid for dashboard-style composition. */
export function Grid({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-12", className)} {...props} />;
}
