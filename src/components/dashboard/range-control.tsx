"use client";

import { useRouter, usePathname } from "next/navigation";
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
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Segmented
      value={value}
      onValueChange={(next) => {
        if (!next) return;
        router.replace(`${pathname}?range=${next}`, { scroll: false });
      }}
      aria-label="Date range"
    >
      {RANGE_OPTIONS.map((o) => (
        <SegmentedItem key={o.value} value={o.value}>
          {o.label}
        </SegmentedItem>
      ))}
    </Segmented>
  );
}
