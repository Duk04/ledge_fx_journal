import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Upload } from "lucide-react";
import { subDays, startOfYear, endOfDay } from "date-fns";
import type { Direction } from "@prisma/client";
import { Page } from "@/components/shell/page";
import { Panel, PanelBody, PanelFooter, SectionHead } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Stat, StatRow } from "@/components/ui/stat";
import { Money, Percent, Pips, RValue } from "@/components/ui/value";
import { DataTable, Td, Th, TableEmpty, TrLink } from "@/components/ui/table";
import { DirectionBadge, Badge, TagChip, SessionBadge } from "@/components/ui/badge";
import { RBar } from "@/components/ui/r-bar";
import { EmptyState } from "@/components/ui/empty";
import { Tip } from "@/components/ui/tooltip";
import { formatInZone, formatPrice } from "@/lib/metrics/formatters";
import { requireAccountAccess, requireUser } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import {
  listTrades,
  listSymbols,
  listTagsForUser,
  tradeStats,
  TRADE_SORT_FIELDS,
  type TradeFilters,
  type TradeOutcomeFilter,
  type TradeSortField,
} from "@/lib/queries/trades";
import { TradeFilterBar } from "@/components/trades/filter-bar";
import { TradePaginationBar } from "@/components/trades/pagination-bar";
import { SortLink } from "@/components/trades/sort-link";
import { TradeRowMenu } from "@/components/trades/row-menu";

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
function csv(v: string | string[] | undefined): string[] {
  const s = first(v);
  return s ? s.split(",").filter(Boolean) : [];
}

/** "7d"/"30d"/"90d"/"ytd"/"all" are resolved relative to *now*, on every
 * request — a saved "last 7 days" link should always mean the last 7 days
 * from whenever it's opened, not a frozen absolute range. Only "custom"
 * carries explicit dates in the URL. */
function resolveDateRange(range: string, fromStr?: string, toStr?: string): { from?: Date; to?: Date } {
  if (range === "custom") {
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? endOfDay(new Date(toStr)) : undefined;
    return { from, to };
  }
  const now = new Date();
  switch (range) {
    case "7d":
      return { from: subDays(now, 7) };
    case "30d":
      return { from: subDays(now, 30) };
    case "90d":
      return { from: subDays(now, 90) };
    case "ytd":
      return { from: startOfYear(now) };
    default:
      return {};
  }
}

function toSearchParams(sp: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, value);
  }
  return params;
}

const PAGE_SIZES = [25, 50, 100];

export default async function TradesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const activeAccountId = await resolveActiveAccountId(user.id);
  const t = await getTranslations("trades");

  if (!activeAccountId) {
    return (
      <Page>
        <SectionHead title={t("list.title")} />
        <Panel>
          <PanelBody>
            <EmptyState title={t("common.noAccountTitle")} description={t("list.noAccountDescription")} />
          </PanelBody>
        </Panel>
      </Page>
    );
  }

  const account = await requireAccountAccess(activeAccountId);

  // -------------------------------------------------------------- filters
  const q = first(sp.q);
  const symbols = csv(sp.symbols);
  const directions = csv(sp.directions) as Direction[];
  const outcome = first(sp.outcome) as TradeOutcomeFilter | undefined;
  const tagIds = csv(sp.tags);
  const range = first(sp.range) ?? "all";
  const followedPlanParam = first(sp.followedPlan);
  const { from, to } = resolveDateRange(range, first(sp.from), first(sp.to));

  const filters: TradeFilters = {
    q,
    symbols: symbols.length ? symbols : undefined,
    directions: directions.length ? directions : undefined,
    outcomes: outcome ? [outcome] : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
    from,
    to,
    followedPlan: followedPlanParam === "yes" ? true : followedPlanParam === "no" ? false : undefined,
  };

  const filtersActive = Boolean(
    q || symbols.length || directions.length || outcome || tagIds.length || range !== "all" || followedPlanParam,
  );

  // ------------------------------------------------------------------ sort
  const sortFieldParam = first(sp.sort);
  const sortField: TradeSortField = (TRADE_SORT_FIELDS as readonly string[]).includes(sortFieldParam ?? "")
    ? (sortFieldParam as TradeSortField)
    : "openedAt";
  const sortDirection: "asc" | "desc" = first(sp.dir) === "asc" ? "asc" : "desc";

  // -------------------------------------------------------------- paging
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const pageSizeParam = Number(first(sp.pageSize));
  const pageSize = PAGE_SIZES.includes(pageSizeParam) ? pageSizeParam : 50;

  const [{ rows, total, scale }, stats, symbolOptions, tagOptions] = await Promise.all([
    listTrades({
      userId: user.id,
      accountId: account.id,
      filters,
      sort: { field: sortField, direction: sortDirection },
      page,
      pageSize,
    }),
    tradeStats(user.id, account.id, filters),
    listSymbols(user.id),
    listTagsForUser(user.id),
  ]);

  function buildSortHref(field: TradeSortField, direction: "asc" | "desc"): string {
    const params = toSearchParams(sp);
    params.set("sort", field);
    params.set("dir", direction);
    params.delete("page");
    return `/trades?${params.toString()}`;
  }

  const noTradesAtAll = total === 0 && !filtersActive;
  const noTradesMatchFilters = total === 0 && filtersActive;

  const breakevenPct = stats.breakevenWinRate !== null ? Math.round(stats.breakevenWinRate * 1000) / 10 : null;
  // Report both runs rather than picking a winner: calling a 6-loss run the
  // "best streak" is nonsense, and the losing run is usually the number a
  // reviewer needs to see.
  const runIsWin = stats.longestWinStreak >= stats.longestLossStreak;
  const netPnlNum = Number(stats.netPnl);

  return (
    <Page>
      <SectionHead
        title={t("list.title")}
        hint={
          <>
            {t("list.inView", { count: total })} <Money value={stats.netPnl} currency={account.currency} signed />
          </>
        }
        actions={
          <Button asChild variant="default" size="sm">
            <Link href="/trades/import">
              <Upload aria-hidden /> {t("import.title")}
            </Link>
          </Button>
        }
      />

      <StatRow>
        <Stat
          label={t("common.netPnl")}
          value={<Money value={stats.netPnl} currency={account.currency} signed />}
          tone={netPnlNum > 0 ? "profit" : netPnlNum < 0 ? "loss" : "neutral"}
        />
        <Stat
          label={t("list.winRate")}
          value={<Percent value={stats.winRate} />}
          hint={breakevenPct !== null ? t("list.breakEvenHint", { pct: breakevenPct }) : undefined}
        />
        <Stat
          label={t("list.profitFactor")}
          value={stats.profitFactor !== null ? Number(stats.profitFactor).toFixed(2) : "—"}
        />
        <Stat
          label={t("list.expectancy")}
          value={<RValue value={stats.expectancyR} />}
          tone={stats.expectancyR !== null ? (Number(stats.expectancyR) >= 0 ? "profit" : "loss") : "neutral"}
        />
        <Stat
          label={t("list.avgR")}
          value={<RValue value={stats.averageRMultiple} />}
          tone={stats.averageRMultiple !== null ? (Number(stats.averageRMultiple) >= 0 ? "profit" : "loss") : "neutral"}
        />
        <Stat
          label={t("list.longestRun")}
          value={
            stats.longestWinStreak + stats.longestLossStreak > 0
              ? t("list.runValue", { wins: stats.longestWinStreak, losses: stats.longestLossStreak })
              : "—"
          }
          hint={
            stats.currentStreak !== 0
              ? t(stats.currentStreak > 0 ? "list.currentWinRun" : "list.currentLossRun", {
                  count: Math.abs(stats.currentStreak),
                })
              : t("list.noRun")
          }
          tone={runIsWin ? "neutral" : "loss"}
        />
      </StatRow>

      <TradeFilterBar symbols={symbolOptions} tags={tagOptions} />

      <Panel flush>
        {noTradesAtAll ? (
          <PanelBody>
            <EmptyState title={t("list.emptyTitle")} description={t("list.emptyDescription")} />
            <div className="flex justify-center pb-4">
              <Button asChild variant="primary" size="sm">
                <Link href="/trades/new">
                  <Plus /> {t("list.logFirst")}
                </Link>
              </Button>
            </div>
          </PanelBody>
        ) : noTradesMatchFilters ? (
          <PanelBody>
            <EmptyState title={t("list.noMatchTitle")} description={t("list.noMatchDescription")} />
            <div className="flex justify-center pb-4">
              <Button asChild variant="default" size="sm">
                <Link href="/trades">{t("list.clearFilters")}</Link>
              </Button>
            </div>
          </PanelBody>
        ) : (
          <>
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
                          isOutlier
                            ? outlierPositive
                              ? "border-l-2 border-l-profit"
                              : "border-l-2 border-l-loss"
                            : undefined
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
                            <span className="text-ink">{formatInZone(row.openedAt, user.timezone, "MMM dd")}</span>
                            <span className="flex items-center gap-1 text-ink-3">
                              {formatInZone(row.openedAt, user.timezone, "HH:mm")}
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
                                ? `1:${Number(row.plannedRR)}`
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
                          <span className="text-ink-3">
                            {row.plannedRR !== null ? `R:R 1:${Number(row.plannedRR)}` : "—"}
                          </span>
                        )}
                      </Td>
                      <Td numeric className="hidden md:table-cell">
                        {row.volumeLots !== null ? Number(row.volumeLots).toFixed(2) : "—"}
                      </Td>
                      <Td numeric className="hidden md:table-cell">
                        <Pips value={row.pips} />
                      </Td>
                      <Td numeric>
                        <Money value={row.netPnl} currency={account.currency} signed />
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
                        <TradeRowMenu accountId={account.id} tradeId={row.id} />
                      </Td>
                    </TrLink>
                  );
                })}
                {rows.length === 0 ? <TableEmpty colSpan={11}>{t("list.noRowsOnPage")}</TableEmpty> : null}
              </tbody>
            </DataTable>
            <PanelFooter>
              <TradePaginationBar page={page} pageSize={pageSize} total={total} />
            </PanelFooter>
          </>
        )}
      </Panel>
    </Page>
  );
}
