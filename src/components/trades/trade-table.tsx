import { getTranslations } from "next-intl/server";
import {
  Badge,
  DataTable,
  DirectionBadge,
  Money,
  Pips,
  RBar,
  RValue,
  SessionBadge,
  TableEmpty,
  TagChip,
  Td,
  Th,
  Tip,
  TrLink,
} from "@/components/ui";
import { formatInZone, formatPrice, formatRR } from "@/lib/metrics/formatters";
import type { TradeListRow, TradeSortField } from "@/lib/queries/trades";
import { SortLink } from "./sort-link";
import { TradeRowMenu } from "./row-menu";
import { ShotCell } from "./trade-shots";

/**
 * The trade list's table: sortable headers, one row per trade, and the
 * phone layout that drops to when/what/which way/money/R/screenshots. Split
 * out of `trades/(list)/page.tsx`, which keeps the query parsing and the page
 * around it. A server component — `buildSortHref` is a server-side closure
 * over the page's search params and never crosses to the client.
 *
 * The screenshot cell is a client button that opens the page's one
 * screenshot dialog, so this must render inside a `TradeShotsProvider`
 * (trade-shots.tsx). It is the second-to-last column on purpose: it stays on
 * a phone, next to the row menu, without moving Symbol from second place.
 */
export async function TradeTable({
  rows,
  scale,
  currency,
  accountId,
  timezone,
  sortField,
  sortDirection,
  buildSortHref,
}: {
  rows: TradeListRow[];
  /** The R bar's full-width value, shared by every row on the page. */
  scale: number;
  currency: string;
  accountId: string;
  timezone: string;
  sortField: TradeSortField;
  sortDirection: "asc" | "desc";
  buildSortHref: (field: TradeSortField, direction: "asc" | "desc") => string;
}) {
  const t = await getTranslations("trades");
  return (
    <DataTable>
      <thead>
        <tr>
          <Th sortable sortDirection={sortField === "openedAt" ? sortDirection : false}>
            <SortLink
              field="openedAt"
              label={t("common.opened")}
              currentField={sortField}
              currentDirection={sortDirection}
              buildHref={buildSortHref}
            />
          </Th>
          <Th sortable sortDirection={sortField === "symbol" ? sortDirection : false}>
            <SortLink
              field="symbol"
              label={t("common.symbol")}
              currentField={sortField}
              currentDirection={sortDirection}
              buildHref={buildSortHref}
            />
          </Th>
          <Th>{t("common.dir")}</Th>
          <Th numeric className="hidden md:table-cell">
            {t("common.entryExit")}
          </Th>
          <Th
            numeric
            className="hidden md:table-cell"
            sortable
            sortDirection={sortField === "volumeLots" ? sortDirection : false}
          >
            <SortLink
              numeric
              field="volumeLots"
              label={t("common.lots")}
              currentField={sortField}
              currentDirection={sortDirection}
              buildHref={buildSortHref}
            />
          </Th>
          <Th
            numeric
            className="hidden md:table-cell"
            sortable
            sortDirection={sortField === "pips" ? sortDirection : false}
          >
            <SortLink
              numeric
              field="pips"
              label={t("common.pips")}
              currentField={sortField}
              currentDirection={sortDirection}
              buildHref={buildSortHref}
            />
          </Th>
          <Th numeric sortable sortDirection={sortField === "netPnl" ? sortDirection : false}>
            <SortLink
              numeric
              field="netPnl"
              label={t("common.netPnl")}
              currentField={sortField}
              currentDirection={sortDirection}
              buildHref={buildSortHref}
            />
          </Th>
          <Th numeric sortable sortDirection={sortField === "rMultiple" ? sortDirection : false}>
            <SortLink
              numeric
              field="rMultiple"
              label={t("common.r")}
              currentField={sortField}
              currentDirection={sortDirection}
              buildHref={buildSortHref}
            />
          </Th>
          <Th aria-label={t("list.rToScale")} className="hidden md:table-cell" />
          <Th className="hidden md:table-cell">{t("common.tags")}</Th>
          <Th aria-label={t("common.screenshots")} />
          <Th aria-label={t("common.actions")} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const absR = row.rMultiple !== null ? Math.abs(Number(row.rMultiple)) : 0;
          const isOutlier = absR >= 2;
          const outlierPositive = row.rMultiple !== null && Number(row.rMultiple) > 0;

          return (
            <TrLink key={row.id} href={`/trades/${row.id}`}>
              {/* The outlier rule sits on the first cell, not the
                  <tr>: DataTable uses border-collapse: separate, and
                  in that model a row's own border is never painted. */}
              <Td
                className={
                  isOutlier ? (outlierPositive ? "border-l-2 border-l-profit" : "border-l-2 border-l-loss") : undefined
                }
              >
                <div className="flex items-center gap-1.5">
                  {row.followedPlan === false ? (
                    <Tip label={t("list.planNotFollowedTip")}>
                      <span
                        role="img"
                        className="relative inline-flex size-1.5 shrink-0 rounded-full bg-warn"
                        aria-label={t("list.planNotFollowed")}
                      />
                    </Tip>
                  ) : null}
                  <div className="mono flex flex-col text-xs leading-tight">
                    <span className="text-ink">{formatInZone(row.openedAt, timezone, "MMM dd")}</span>
                    <span className="flex items-center gap-1 text-ink-3">
                      {formatInZone(row.openedAt, timezone, "HH:mm")}
                      <SessionBadge session={row.marketSession} />
                    </span>
                  </div>
                </div>
              </Td>
              <Td>
                <div className="flex flex-col">
                  <span className="font-medium text-ink">{row.symbol}</span>
                  <span className="mono text-2xs text-ink-3">
                    {row.entryPrice !== null
                      ? formatPrice(Number(row.entryPrice), row.digits)
                      : row.plannedRR !== null
                        ? formatRR(row.plannedRR)
                        : null}
                  </span>
                </div>
              </Td>
              <Td>
                <DirectionBadge direction={row.direction} />
              </Td>
              {/* Below md the table drops to what a phone needs to scan:
                  when, what, which way, money, R. */}
              <Td numeric className="hidden md:table-cell">
                {row.entryPrice !== null ? (
                  <>
                    {formatPrice(Number(row.entryPrice), row.digits)}
                    <span className="text-ink-3"> → </span>
                    {row.exitPrice !== null ? (
                      formatPrice(Number(row.exitPrice), row.digits)
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </>
                ) : (
                  // An R-mode trade has no prices; its plan is the R:R.
                  <span className="text-ink-3">{row.plannedRR !== null ? `R:R ${formatRR(row.plannedRR)}` : "—"}</span>
                )}
              </Td>
              <Td numeric className="hidden md:table-cell">
                {row.volumeLots !== null ? Number(row.volumeLots).toFixed(2) : "—"}
              </Td>
              <Td numeric className="hidden md:table-cell">
                <Pips value={row.pips} />
              </Td>
              <Td numeric>
                <Money value={row.netPnl} currency={currency} signed />
              </Td>
              <Td numeric>
                <RValue value={row.rMultiple} />
              </Td>
              <Td className="hidden md:table-cell">
                <div className="flex justify-end">
                  <RBar value={row.rMultiple} scale={scale} />
                </div>
              </Td>
              <Td className="hidden md:table-cell">
                <div className="flex items-center gap-1">
                  {row.tags.slice(0, 2).map((tag) => (
                    <TagChip key={tag.id} name={tag.name} color={tag.color} />
                  ))}
                  {row.tags.length > 2 ? <Badge tone="neutral">+{row.tags.length - 2}</Badge> : null}
                </div>
              </Td>
              <Td>
                <ShotCell tradeId={row.id} count={row.attachments.length} />
              </Td>
              <Td>
                <TradeRowMenu accountId={accountId} tradeId={row.id} />
              </Td>
            </TrLink>
          );
        })}
        {rows.length === 0 ? <TableEmpty colSpan={12}>{t("list.noRowsOnPage")}</TableEmpty> : null}
      </tbody>
    </DataTable>
  );
}
