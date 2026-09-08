"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Segmented, SegmentedItem } from "./segmented";

const PAGE_SIZES = [25, 50, 100] as const;

/**
 * "1–50 of 312", a page-size switch, and prev/next — the footer every table
 * in the app ends with. Wraps to two lines under ~360px rather than
 * truncating the count, since that count is the one thing worth keeping.
 */
export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
  onPageSize,
  className,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  className?: string;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className,
      )}
    >
      <span className="mono text-xs text-ink-3">
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        {onPageSize ? (
          <Segmented
            value={String(pageSize)}
            onValueChange={(v: string) => v && onPageSize(Number(v))}
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((size) => (
              <SegmentedItem key={size} value={String(size)}>
                {size}
              </SegmentedItem>
            ))}
          </Segmented>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="mono px-1 text-xs text-ink-2">
            {page} / {Math.max(1, pageCount)}
          </span>
          <Button
            variant="default"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
