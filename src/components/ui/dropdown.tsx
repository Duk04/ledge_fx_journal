"use client";

import * as React from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;
export const DropdownGroup = DropdownPrimitive.Group;
export const DropdownSub = DropdownPrimitive.Sub;
export const DropdownSubTrigger = DropdownPrimitive.SubTrigger;
export const DropdownSubContent = DropdownPrimitive.SubContent;

export function DropdownContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-[var(--radius-overlay)] border border-line bg-panel-raised p-1 text-ink shadow-overlay",
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Item> & { tone?: "default" | "danger" }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-inner px-2 text-sm outline-none",
        tone === "danger" ? "text-loss data-[highlighted]:bg-loss-weak" : "text-ink data-[highlighted]:bg-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "relative flex h-8 cursor-default select-none items-center rounded-inner py-0 pl-7 pr-2 text-sm text-ink outline-none",
        "data-[highlighted]:bg-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <DropdownPrimitive.ItemIndicator className="absolute left-2 flex items-center">
        <Check className="size-3.5 text-brand" aria-hidden />
      </DropdownPrimitive.ItemIndicator>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}

export function DropdownLabel({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("label px-2 py-1.5", className)} {...props} />;
}

export function DropdownSeparator({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Separator>) {
  return <DropdownPrimitive.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}
