import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TradeSortField } from "@/lib/queries/trades";

/**
 * A `<Th sortable>`'s clickable header, built as a `Link` rather than
 * `ColumnHeader`'s `<button onClick>` — sorting is a navigation (the URL is
 * the source of truth for every list parameter, see docs/TRADES.md), so it
 * should be a plain link a user can open in a new tab, not a client-side
 * handler. Visually identical to `ColumnHeader`; that component stays a
 * button because it's shared with contexts that really do need one.
 */
export function SortLink({
  field,
  label,
  currentField,
  currentDirection,
  buildHref,
  numeric,
}: {
  field: TradeSortField;
  label: React.ReactNode;
  currentField: TradeSortField;
  currentDirection: "asc" | "desc";
  buildHref: (field: TradeSortField, direction: "asc" | "desc") => string;
  numeric?: boolean;
}) {
  const active = field === currentField;
  // Clicking the active column flips direction; a fresh column starts desc
  // — newest/largest first is the useful default for every sortable column
  // in this table (dates, money, R, pips, volume all read "biggest first").
  const nextDirection: "asc" | "desc" = active && currentDirection === "desc" ? "asc" : "desc";
  const Icon = active && currentDirection === "asc" ? ChevronUp : ChevronDown;

  return (
    <Link
      href={buildHref(field, nextDirection)}
      className={cn("flex h-full w-full items-center gap-1 px-3 py-0", numeric && "flex-row-reverse")}
      scroll={false}
    >
      <span>{label}</span>
      <Icon
        className={cn("size-3 shrink-0 text-ink-3", active ? "opacity-100" : "opacity-0 group-hover/th:opacity-100")}
        aria-hidden
      />
    </Link>
  );
}
