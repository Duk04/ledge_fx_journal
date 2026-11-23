"use client";

/** Thin URL-syncing wrapper around the shared `Pagination` component — that
 * component takes plain callbacks, not hrefs, so this is where "page" and
 * "pageSize" become query params (see docs/TRADES.md for the full contract). */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pagination } from "@/components/ui";

export function TradePaginationBar({
  page,
  pageSize,
  total,
  sizes = true,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** False where the page size is not the reader's to pick — the Days view
   * pages by day, a fixed number of them. */
  sizes?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function go(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      total={total}
      onPage={(next) => go({ page: String(next) })}
      onPageSize={sizes ? (size) => go({ pageSize: String(size), page: "1" }) : undefined}
    />
  );
}
