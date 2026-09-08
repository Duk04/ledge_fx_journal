"use client";

/**
 * The trade list's filter bar. Every control here writes straight to the URL
 * (via `useRouter().replace`, never `push` — filtering isn't a navigation
 * event worth a back-button stop) so a filtered view is a link you can send
 * someone, and a reload lands you back where you were. See docs/TRADES.md
 * for the full query-param contract this reads and writes.
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SearchInput } from "@/components/ui/input";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import {
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import type { TagOption } from "@/lib/queries/trades";

// Radix's single-select ToggleGroup treats "" as its own internal
// "nothing selected" sentinel, so an "All" item can't use "" as its value
// (it would fight with deselection) — ANY_* sentinels stand in for it and
// are translated to/from an absent query param at the read/write edges.
const ANY_OUTCOME = "ANY";
const ANY_PLAN = "ANY";

const OUTCOME_OPTIONS = [
  { value: ANY_OUTCOME, label: "All" },
  { value: "WIN", label: "Win" },
  { value: "LOSS", label: "Loss" },
  { value: "BREAKEVEN", label: "BE" },
  { value: "OPEN", label: "Open" },
] as const;

const RANGE_OPTIONS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All" },
] as const;

/** Query-param keys this bar owns. Kept in one place so "does setting this
 * filter clear the page number" and "is anything set at all" agree. */
const FILTER_KEYS = [
  "q",
  "symbols",
  "directions",
  "outcome",
  "tags",
  "range",
  "from",
  "to",
  "followedPlan",
] as const;

function splitCsv(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

export function TradeFilterBar({ symbols, tags }: { symbols: string[]; tags: TagOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = React.useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      symbols: splitCsv(searchParams.get("symbols")),
      directions: splitCsv(searchParams.get("directions")),
      outcome: searchParams.get("outcome") ?? ANY_OUTCOME,
      tags: splitCsv(searchParams.get("tags")),
      range: searchParams.get("range") ?? "all",
      from: searchParams.get("from") ?? "",
      to: searchParams.get("to") ?? "",
      followedPlan: searchParams.get("followedPlan") ?? ANY_PLAN,
    }),
    [searchParams],
  );

  // Reset the draft when the URL's `q` changes for a reason OTHER than this
  // component's own debounce (e.g. "Clear filters", browser back/forward).
  // Adjusted during render (React's documented pattern for "state that
  // should reset when a prop changes") rather than in an effect, which
  // would flash the old value for one frame and cause an extra render.
  const [priorQ, setPriorQ] = React.useState(current.q);
  const [searchDraft, setSearchDraft] = React.useState(current.q);
  if (current.q !== priorQ) {
    setPriorQ(current.q);
    setSearchDraft(current.q);
  }

  const update = React.useCallback(
    (patch: Record<string, string | string[] | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        const joined = Array.isArray(value) ? value.join(",") : value;
        if (!joined) params.delete(key);
        else params.set(key, joined);
      }
      params.delete("page"); // any filter change starts back at page 1
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Debounce text search only — every other control is a discrete click and
  // should apply immediately.
  //
  // `update` and `current.q` belong in the dependency list, and leaving them
  // out was a real bug rather than a lint technicality. `update` closes over
  // `searchParams`; with `[searchDraft]` alone the effect did not re-run when
  // any OTHER filter changed, so a pending 250ms timer still held the
  // `update` built from the pre-change URL. Firing it rebuilt the query
  // string from those stale params and silently reverted the filter the user
  // had just set — visible only as a control that flicked back on its own.
  //
  // With them listed, changing another filter re-runs this effect and resets
  // the timer, which is also the better behaviour: the search then applies
  // against the URL as it actually is. No loop, because `update({ q })`
  // changes `searchParams`, which re-runs this effect, which returns early
  // now that `searchDraft === current.q`.
  React.useEffect(() => {
    if (searchDraft === current.q) return;
    const timer = window.setTimeout(() => update({ q: searchDraft }), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft, current.q, update]);

  const hasFilters = FILTER_KEYS.some((key) => {
    const value = current[key as keyof typeof current];
    if (key === "range") return value !== "all";
    if (key === "outcome") return value !== ANY_OUTCOME;
    if (key === "followedPlan") return value !== ANY_PLAN;
    return Array.isArray(value) ? value.length > 0 : value !== "";
  });

  function toggleInList(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
        onClear={() => setSearchDraft("")}
        placeholder="Search symbol or notes…"
        className="w-full sm:w-56"
        aria-label="Search trades"
      />

      <MultiSelectMenu
        label="Symbol"
        options={symbols.map((s) => ({ value: s, label: s }))}
        selected={current.symbols}
        onToggle={(value) => update({ symbols: toggleInList(current.symbols, value) })}
      />

      <MultiSelectMenu
        label="Direction"
        options={[
          { value: "LONG", label: "Long" },
          { value: "SHORT", label: "Short" },
        ]}
        selected={current.directions}
        onToggle={(value) => update({ directions: toggleInList(current.directions, value) })}
      />

      <MultiSelectMenu
        label="Tags"
        options={tags.map((t) => ({ value: t.id, label: t.name }))}
        selected={current.tags}
        onToggle={(value) => update({ tags: toggleInList(current.tags, value) })}
      />

      <Segmented
        value={current.outcome}
        onValueChange={(v) => v && update({ outcome: v === ANY_OUTCOME ? null : v })}
        aria-label="Outcome"
      >
        {OUTCOME_OPTIONS.map((opt) => (
          <SegmentedItem key={opt.value} value={opt.value}>
            {opt.label}
          </SegmentedItem>
        ))}
      </Segmented>

      <Segmented
        value={current.range}
        onValueChange={(v) => v && update({ range: v, from: v === "custom" ? current.from : null, to: v === "custom" ? current.to : null })}
        aria-label="Date range"
      >
        {RANGE_OPTIONS.map((opt) => (
          <SegmentedItem key={opt.value} value={opt.value}>
            {opt.label}
          </SegmentedItem>
        ))}
        <SegmentedItem value="custom">Custom</SegmentedItem>
      </Segmented>

      <Segmented
        value={current.followedPlan}
        onValueChange={(v) => v && update({ followedPlan: v === ANY_PLAN ? null : v })}
        aria-label="Plan discipline"
      >
        <SegmentedItem value={ANY_PLAN}>Plan: All</SegmentedItem>
        <SegmentedItem value="yes">Followed</SegmentedItem>
        <SegmentedItem value="no">Broke</SegmentedItem>
      </Segmented>

      {current.range === "custom" ? (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={current.from}
            onChange={(e) => update({ from: e.target.value || null })}
            className="h-control rounded-[var(--radius-control)] border border-line bg-panel px-2 text-xs text-ink"
            aria-label="From date"
          />
          <span className="text-ink-3">–</span>
          <input
            type="date"
            value={current.to}
            onChange={(e) => update({ to: e.target.value || null })}
            className="h-control rounded-[var(--radius-control)] border border-line bg-panel px-2 text-xs text-ink"
            aria-label="To date"
          />
        </div>
      ) : null}

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearchDraft("");
            const params = new URLSearchParams();
            for (const [key, value] of searchParams.entries()) {
              if (!FILTER_KEYS.includes(key as (typeof FILTER_KEYS)[number])) params.set(key, value);
            }
            const qs = params.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
          }}
        >
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}

function MultiSelectMenu({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="default" size="md" className={cn(selected.length > 0 && "border-brand-line text-brand")}>
          {label}
          {selected.length > 0 ? <span className="mono text-2xs">{selected.length}</span> : null}
        </Button>
      </DropdownTrigger>
      <DropdownContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownLabel>{label}</DropdownLabel>
        <DropdownSeparator />
        {options.length === 0 ? (
          <div className="px-2 py-3 text-xs text-ink-3">Nothing to filter by yet.</div>
        ) : (
          options.map((opt) => (
            <DropdownCheckboxItem
              key={opt.value}
              checked={selected.includes(opt.value)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggle(opt.value)}
            >
              {opt.label}
            </DropdownCheckboxItem>
          ))
        )}
      </DropdownContent>
    </Dropdown>
  );
}
