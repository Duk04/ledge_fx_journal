"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

/**
 * Tabs whose selection lives in the URL (`?tab=`), so a tab can be linked
 * to, survives a reload, and the back button steps through tabs. The server
 * page reads `tab` from its searchParams and passes it as `value`; switching
 * replaces the URL without scrolling and keeps every other query parameter
 * (the analytics range, say).
 */
export function UrlTabs({
  value,
  param = "tab",
  ...props
}: Omit<React.ComponentProps<typeof TabsPrimitive.Root>, "value" | "defaultValue" | "onValueChange"> & {
  value: string;
  param?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [current, setCurrent] = React.useState(value);
  return (
    <TabsPrimitive.Root
      value={current}
      onValueChange={(next) => {
        setCurrent(next);
        const params = new URLSearchParams(search.toString());
        params.set(param, next);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      {...props}
    />
  );
}
