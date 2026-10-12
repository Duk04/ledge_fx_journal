"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented, SegmentedItem } from "@/components/ui";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/range";

/**
 * The 7d/30d/90d/YTD/All Segmented shared by Overview and Analytics. Reads
 * its current value from the server-resolved `value` prop (never
 * `useSearchParams`, so this never needs its own Suspense boundary) and
 * writes the new one straight into the URL — both pages read `range` back
 * out of `searchParams` on the next render.
 */
export function RangeControl({ value }: { value: RangeKey }) {
  const t = useTranslations("dashboard.range");
  const router = useRouter();
  const pathname = usePathname();
  // A range change re-renders the whole page on the server, which can take a
  // moment on a big account; without this the click looked ignored until the
  // new numbers landed. The control dims and reports busy while it runs.
  const [pending, startTransition] = React.useTransition();

  return (
    <Segmented
      value={value}
      onValueChange={(next) => {
        if (!next) return;
        startTransition(() => router.replace(`${pathname}?range=${next}`, { scroll: false }));
      }}
      aria-label={t("ariaLabel")}
      aria-busy={pending || undefined}
      className={pending ? "opacity-60" : undefined}
    >
      {RANGE_OPTIONS.map((o) => (
        <SegmentedItem key={o.value} value={o.value}>
          {/* Translated by value: RANGE_OPTIONS' own labels are the English ones. */}
          {t(o.value)}
        </SegmentedItem>
      ))}
    </Segmented>
  );
}
