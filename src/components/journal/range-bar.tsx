"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Field, FieldLabel, Input, Segmented, SegmentedItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import { JOURNAL_PRESETS, type JournalPreset } from "@/lib/range";

/**
 * The journal's date range: two dates, plus Today / Last week / Last month.
 * The server resolves the range (lib/range.ts, `resolveJournalRange`) and
 * passes both the dates and what each preset means *today in the user's
 * timezone* — so this component never does timezone arithmetic in the
 * browser, whose zone may not be the user's.
 *
 * Writes `from`/`to` into the URL, keeping the calendar's `month`. Like
 * RangeControl, it takes what it needs as props rather than reading
 * `useSearchParams`, so it never needs its own Suspense boundary.
 */
export function RangeBar({
  from,
  to,
  preset,
  presets,
  month,
}: {
  from: string;
  to: string;
  preset: JournalPreset | null;
  presets: Record<JournalPreset, { from: string; to: string }>;
  /** The calendar's `?month`, carried through unchanged. */
  month?: string;
}) {
  const t = useTranslations("journal.range");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();

  function go(next: { from: string; to: string }) {
    if (!next.from || !next.to || next.from > next.to) return;
    const q = new URLSearchParams({ from: next.from, to: next.to });
    if (month) q.set("month", month);
    startTransition(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
  }

  return (
    <div className={cn("flex flex-wrap items-end gap-3", pending && "opacity-60")} aria-busy={pending || undefined}>
      <div className="flex items-end gap-2">
        <Field>
          <FieldLabel>{t("from")}</FieldLabel>
          <Input type="date" value={from} max={to} onChange={(e) => go({ from: e.target.value, to })} />
        </Field>
        <span className="pb-2 text-ink-3" aria-hidden>
          –
        </span>
        <Field>
          <FieldLabel>{t("to")}</FieldLabel>
          <Input type="date" value={to} min={from} onChange={(e) => go({ from, to: e.target.value })} />
        </Field>
      </div>
      <Segmented
        value={preset ?? ""}
        onValueChange={(v) => v && go(presets[v as JournalPreset])}
        aria-label={t("ariaLabel")}
      >
        {JOURNAL_PRESETS.map((p) => (
          <SegmentedItem key={p} value={p}>
            {t(p)}
          </SegmentedItem>
        ))}
      </Segmented>
    </div>
  );
}
