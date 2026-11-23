"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented, SegmentedItem } from "@/components/ui";

export type TradeListView = "table" | "days";

/**
 * Table or Days, for the trade list. Like every other control on that page it
 * writes the URL (`?view=days`; absent means the table) and keeps the filters
 * that are there. It drops `page`: page 3 of the table and page 3 of the days
 * are not the same place.
 */
export function TradeViewSwitch({ value }: { value: TradeListView }) {
  const t = useTranslations("trades.list.view");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  return (
    <Segmented
      value={value}
      onValueChange={(next) => {
        if (!next || next === value) return;
        const params = new URLSearchParams(searchParams.toString());
        if (next === "days") params.set("view", "days");
        else params.delete("view");
        params.delete("page");
        const qs = params.toString();
        startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
      }}
      aria-label={t("label")}
      aria-busy={pending || undefined}
      className={pending ? "opacity-60" : undefined}
    >
      <SegmentedItem value="table">{t("table")}</SegmentedItem>
      <SegmentedItem value="days">{t("days")}</SegmentedItem>
    </Segmented>
  );
}
