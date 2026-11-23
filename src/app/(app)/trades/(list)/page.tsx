import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Upload } from "lucide-react";
import { Page } from "@/components/shell/page";
import {
  Panel,
  PanelBody,
  PanelFooter,
  SectionHead,
  Button,
  Stat,
  StatRow,
  Money,
  Percent,
  RValue,
  EmptyState,
} from "@/components/ui";
import { requireAccountAccess, requireUser } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import {
  listTradeDays,
  listTrades,
  listSymbols,
  listTagsForUser,
  tradeStats,
  TRADE_SORT_FIELDS,
  type TradeSortField,
} from "@/lib/queries/trades";
import { first, parseTradeListQuery, type SearchParams } from "@/lib/trade-list-query";
import { TradeFilterBar } from "@/components/trades/filter-bar";
import { TradePaginationBar } from "@/components/trades/pagination-bar";
import { TradeTable } from "@/components/trades/trade-table";
import { TradeDays } from "@/components/trades/trade-days";
import { TradeViewSwitch, type TradeListView } from "@/components/trades/view-switch";
import { TradeShotsProvider } from "@/components/trades/trade-shots";
import { uploadsAvailable } from "@/lib/storage";

function toSearchParams(sp: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, value);
  }
  return params;
}

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

  // ----------------------------------------------------- filters + paging
  // Parsed in the user's timezone, unknown values dropped (lib/trade-list-query.ts).
  const { filters, filtersActive, page, pageSize } = parseTradeListQuery(sp, user.timezone);

  // ------------------------------------------------------------------ sort
  const sortFieldParam = first(sp.sort);
  const sortField: TradeSortField = (TRADE_SORT_FIELDS as readonly string[]).includes(sortFieldParam ?? "")
    ? (sortFieldParam as TradeSortField)
    : "openedAt";
  const sortDirection: "asc" | "desc" = first(sp.dir) === "asc" ? "asc" : "desc";

  // ------------------------------------------------------------------ view
  // The same filters, shown two ways: a sortable table paged by trade, or
  // days (newest first, paged by day) that lead with each trade's screenshot.
  const view: TradeListView = first(sp.view) === "days" ? "days" : "table";
  const DAYS_PER_PAGE = 10;

  const [list, dayList, stats, symbolOptions, tagOptions] = await Promise.all([
    view === "table"
      ? listTrades({
          userId: user.id,
          accountId: account.id,
          filters,
          sort: { field: sortField, direction: sortDirection },
          page,
          pageSize,
        })
      : null,
    view === "days"
      ? listTradeDays({
          userId: user.id,
          accountId: account.id,
          timezone: user.timezone,
          filters,
          page,
          daysPerPage: DAYS_PER_PAGE,
        })
      : null,
    tradeStats(user.id, account.id, filters),
    listSymbols(user.id),
    listTagsForUser(user.id),
  ]);
  const total = list?.total ?? dayList?.total ?? 0;
  const rows = list?.rows ?? [];
  const scale = list?.scale ?? 1;
  const days = dayList?.days ?? [];
  // Every trade on the page, in reading order: what the screenshot dialog's
  // Previous / Next walks.
  const shotRows = view === "days" ? days.flatMap((d) => d.trades) : rows;

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
          <div className="flex flex-wrap items-center gap-2">
            <TradeViewSwitch value={view} />
            <Button asChild variant="default" size="sm">
              <Link href="/trades/import">
                <Upload aria-hidden /> {t("import.title")}
              </Link>
            </Button>
          </div>
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

      {noTradesAtAll || noTradesMatchFilters ? (
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
          ) : null}
        </Panel>
      ) : (
        // Owns the one screenshot dialog both views' cells open.
        <TradeShotsProvider
          rows={shotRows}
          accountId={account.id}
          currency={account.currency}
          timezone={user.timezone}
          uploadsEnabled={uploadsAvailable()}
        >
          {view === "days" ? (
            <>
              <TradeDays days={days} currency={account.currency} timezone={user.timezone} />
              <TradePaginationBar page={page} pageSize={DAYS_PER_PAGE} total={dayList?.totalDays ?? 0} sizes={false} />
            </>
          ) : (
            <Panel flush>
              <TradeTable
                rows={rows}
                scale={scale}
                currency={account.currency}
                accountId={account.id}
                timezone={user.timezone}
                sortField={sortField}
                sortDirection={sortDirection}
                buildSortHref={buildSortHref}
              />
              <PanelFooter>
                <TradePaginationBar page={page} pageSize={pageSize} total={total} />
              </PanelFooter>
            </Panel>
          )}
        </TradeShotsProvider>
      )}
    </Page>
  );
}
