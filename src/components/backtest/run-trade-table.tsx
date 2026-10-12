import { getTranslations } from "next-intl/server";
import { DataTable, Th, Td, TableEmpty } from "@/components/ui/table";
import { DirectionBadge, SessionBadge } from "@/components/ui/badge";
import { Money, Pips, RValue } from "@/components/ui/value";
import { RBar } from "@/components/ui/r-bar";
import { formatPrice } from "@/lib/metrics/formatters";
import type { RunTradeRow } from "@/lib/queries/backtests";

/** Trades beyond this are still counted in every stat on the page (getRun
 * summarizes ALL of a run's trades) — this cap only bounds how many rows
 * the table itself renders, so a strategy that traded every bar of a
 * 500k-bar run doesn't ship a five-figure table to the browser. */
const MAX_ROWS = 300;

export async function RunTradeTable({ trades, currency }: { trades: RunTradeRow[]; currency: string }) {
  const t = await getTranslations("backtest.tradeTable");
  const shown = trades.slice(0, MAX_ROWS);
  const scale =
    Math.max(1, ...trades.map((trade) => (trade.rMultiple !== null ? Math.abs(Number(trade.rMultiple)) : 0))) || 3;

  return (
    <>
      <DataTable>
        <thead>
          <tr>
            <Th>{t("opened")}</Th>
            <Th>{t("dir")}</Th>
            <Th numeric>{t("entryExit")}</Th>
            <Th numeric>{t("lots")}</Th>
            <Th numeric>{t("pips")}</Th>
            <Th numeric>{t("netPnl")}</Th>
            <Th numeric>R</Th>
            <Th aria-label={t("rScale")} />
          </tr>
        </thead>
        <tbody>
          {shown.map((trade) => {
            const openedAt = new Date(trade.openedAt);
            return (
              <tr key={trade.id}>
                <Td>
                  <div className="mono flex flex-col text-xs leading-tight">
                    <span className="text-ink">
                      {openedAt.toLocaleDateString(undefined, { month: "short", day: "2-digit" })}
                    </span>
                    <span className="flex items-center gap-1 text-ink-3">
                      {openedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      <SessionBadge session={trade.marketSession} />
                    </span>
                  </div>
                </Td>
                <Td>
                  <DirectionBadge direction={trade.direction} />
                </Td>
                <Td numeric>
                  {formatPrice(Number(trade.entryPrice), trade.digits)}
                  <span className="text-ink-3"> → </span>
                  {trade.exitPrice !== null ? (
                    formatPrice(Number(trade.exitPrice), trade.digits)
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Td>
                <Td numeric>{Number(trade.volumeLots).toFixed(2)}</Td>
                <Td numeric>
                  <Pips value={trade.pips} />
                </Td>
                <Td numeric>
                  <Money value={trade.netPnl} currency={currency} signed />
                </Td>
                <Td numeric>
                  <RValue value={trade.rMultiple} />
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <RBar value={trade.rMultiple} scale={scale} />
                  </div>
                </Td>
              </tr>
            );
          })}
          {trades.length === 0 ? <TableEmpty colSpan={8}>{t("empty")}</TableEmpty> : null}
        </tbody>
      </DataTable>
      {trades.length > MAX_ROWS ? (
        <p className="px-3 py-2 text-2xs text-ink-3">
          {t("truncated", { shown: String(MAX_ROWS), total: String(trades.length) })}
        </p>
      ) : null}
    </>
  );
}
