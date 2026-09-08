import * as React from "react";
import { cn } from "@/lib/cn";

/** The loading primitive everything else here composes. `animate-pulse` at
 * the default Tailwind timing (2s) reads as urgent for a 13px UI — slowed to
 * 1.4s so a busy screen full of these doesn't feel like it's alarming you. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-[3px] bg-inset", className)}
      style={{ animationDuration: "1.4s" }}
      {...props}
    />
  );
}

export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Sized to `.data-table`'s own row height so a table doesn't jump once real
 * rows replace these. */
export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} style={{ height: "var(--row-h)" }} className="px-3">
              <Skeleton className="h-3 w-full max-w-32" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
