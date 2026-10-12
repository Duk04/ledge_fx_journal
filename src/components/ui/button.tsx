"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

type Variant = "primary" | "default" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const base =
  "relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control " +
  "font-medium transition-[background-color,border-color,color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  // One filled button per view, at most. Everything else is a hairline.
  primary:
    "bg-brand text-brand-ink hover:bg-brand-hover active:translate-y-px shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]",
  default: "border border-line bg-panel text-ink hover:bg-hover hover:border-line-strong active:bg-active",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink active:bg-active",
  danger: "border border-loss/35 bg-loss-weak text-loss hover:bg-loss/15 hover:border-loss/55",
  link: "text-brand underline-offset-3 hover:underline px-0",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2 text-xs [&_svg]:size-3.5",
  md: "h-control px-2.5 text-sm [&_svg]:size-4",
  lg: "h-control-lg px-3.5 text-sm [&_svg]:size-4",
  icon: "size-control [&_svg]:size-4",
  "icon-sm": "size-7 [&_svg]:size-3.5",
};

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

export function Button({ className, variant = "default", size = "md", asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(base, variants[variant], sizes[size], variant !== "link" && "", className)} {...props} />;
}

/**
 * A row of buttons that share edges — used for table row actions and toolbar
 * clusters. Collapsing the borders keeps a dense toolbar from turning into a
 * fence of outlines.
 */
export function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "inline-flex items-center [&>button]:rounded-none",
        "[&>button:first-child]:rounded-l-[var(--radius-control)] [&>button:last-child]:rounded-r-[var(--radius-control)]",
        "[&>button+button]:-ml-px",
        className,
      )}
      {...props}
    />
  );
}
