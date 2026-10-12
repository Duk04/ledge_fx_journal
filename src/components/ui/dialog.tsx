"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;

type Size = "sm" | "md" | "lg";
type Variant = "dialog" | "sheet" | "drawer";

const sizes: Record<Size, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

/**
 * One primitive backs both the centred dialog and the mobile sheet — a sheet
 * is just a dialog anchored to the bottom edge with its own radius and safe
 * area padding. `variant="sheet"` is what mobile trade entry uses; it stays
 * bottom-pinned on small screens and centres like a normal dialog above the
 * `sm` breakpoint so it never needs a second component to maintain.
 */
export function DialogContent({
  className,
  size = "md",
  variant = "dialog",
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  size?: Size;
  variant?: Variant;
  showClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-scrim backdrop-blur-[1px]",
          "data-[state=open]:animate-[fade-in_var(--dur)_var(--ease-out)]",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col border border-line bg-panel text-ink shadow-overlay outline-none",
          variant === "drawer"
            ? cn(
                // Left-edge panel: the mobile navigation. Radix supplies the
                // focus trap, Esc, scroll lock and focus return the hand-built
                // drawer it replaced had none of.
                "inset-y-0 left-0 h-full w-64 max-w-[85vw] border-y-0 border-l-0",
                "data-[state=open]:animate-[drawer-in_var(--dur)_var(--ease-out)]",
              )
            : variant === "sheet"
              ? cn(
                  "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-[var(--radius-overlay)]",
                  "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
                  "data-[state=open]:animate-[sheet-in_var(--dur)_var(--ease-out)]",
                  "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-h-[70vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-overlay)] sm:pb-0",
                  sizes[size],
                )
              : cn(
                  "top-1/2 left-1/2 max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-overlay)]",
                  "data-[state=open]:animate-[dialog-in_var(--dur)_var(--ease-out)]",
                  sizes[size],
                ),
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className={cn(
              "absolute top-3 right-3 grid size-7 place-items-center rounded-control text-ink-3",
              "transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              "hover:bg-hover hover:text-ink",
            )}
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
      {/* One-off keyframes: Tailwind's arbitrary `animate-[...]` values still need the
          @keyframes body defined somewhere, and globals.css is off-limits. The global
          reduced-motion rule in globals.css already zeroes animation-duration for
          everyone, so nothing extra is needed here for that. */}
      <style>{`
        @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes dialog-in { from { opacity: 0; transform: translate(-50%, calc(-50% + 2px)) } to { opacity: 1; transform: translate(-50%, -50%) } }
        @keyframes sheet-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes drawer-in { from { opacity: 0; transform: translateX(-12px) } to { opacity: 1; transform: translateX(0) } }
      `}</style>
    </DialogPrimitive.Portal>
  );
}

/** Same primitive, sheet-flavoured by default — the name is what call sites
 * reach for in mobile trade entry so the intent reads at the call site. */
export function Sheet(props: Omit<React.ComponentProps<typeof DialogContent>, "variant">) {
  return <DialogContent variant="sheet" {...props} />;
}

export function DialogHeader({
  title,
  description,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { title?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className={cn("flex shrink-0 flex-col gap-1 border-b border-line px-4 py-3 pr-10", className)} {...props}>
      {children ?? (
        <>
          {title ? (
            <DialogPrimitive.Title className="text-sm font-semibold text-ink">{title}</DialogPrimitive.Title>
          ) : null}
          {description ? (
            <DialogPrimitive.Description className="text-xs text-ink-3">{description}</DialogPrimitive.Description>
          ) : null}
        </>
      )}
    </div>
  );
}

export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("max-h-[70vh] min-h-0 flex-1 overflow-y-auto p-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 border-t border-line bg-panel-sunken px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}
