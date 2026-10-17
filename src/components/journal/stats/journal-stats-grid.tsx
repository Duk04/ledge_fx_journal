import { getTranslations } from "next-intl/server";
import { Donut, Gauge, Money } from "@/components/ui";
import {
  formatDuration,
  formatInZone,
  formatMoney,
  formatPercent,
  formatPrice,
  formatR,
} from "@/lib/metrics/formatters";
import type { JournalStats, JournalTradeCard } from "@/lib/queries/analytics";
import { StatCard, toneOf } from "./stat-card";

/**
 * The journal page's figures, in the order a trader reads them: did I make
 * money and how often, how big are wins against losses, which days and how
 * long, and the two trades that bracket the period. Every figure comes from
 * `journalStats` (closed trades by close date) — see that module's header
 * for why it shares the calendar's convention rather than the dashboard's.
 */
export async function JournalStatsGrid({ stats, timezone }: { stats: JournalStats; timezone: string }) {
  const t = await getTranslations("journal.stats");
  const tDay = await getTranslations("analytics.labels.weekday");
  const tEnum = await getTranslations("enums");
  const money = (n: number | null) => formatMoney(n, stats.currency);
  const none = t("noTrades");
  const hasTrades = stats.tradeCount > 0;

  const tradeLine = (c: JournalTradeCard) =>
    c.entryPrice !== null && c.exitPrice !== null
      ? t("tradeLinePrice", {
          direction: tEnum(`direction.${c.direction}`),
          symbol: c.symbol,
          entry: formatPrice(c.entryPrice, c.digits),
          exit: formatPrice(c.exitPrice, c.digits),
        })
      : t("tradeLineR", { direction: tEnum(`direction.${c.direction}`), symbol: c.symbol, r: formatR(c.rMultiple) });

  const tradeAside = (c: JournalTradeCard | null) =>
    c ? (
      <>
        <span>{tradeLine(c)}</span>
        <span className="mono">{formatInZone(c.closedAt, timezone, "MM/dd/yyyy HH:mm")}</span>
      </>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label={t("totalPnl")}
          help={t("totalPnlHelp")}
          value={hasTrades ? <Money value={stats.netPnl} currency={stats.currency} colour={false} /> : none}
          tone={toneOf(stats.netPnl)}
        />
        <StatCard
          label={t("winRate")}
          help={t("winRateHelp")}
          value={stats.winRate !== null ? formatPercent(stats.winRate, 2) : none}
          detail={hasTrades ? t("winsLosses", { wins: stats.wins, losses: stats.losses }) : undefined}
          aside={hasTrades ? <Gauge positive={stats.wins} negative={stats.losses} /> : null}
        />
        <StatCard
          label={t("avgWinLoss")}
          help={t("avgWinLossHelp")}
          value={stats.payoffRatio !== null ? stats.payoffRatio.toFixed(2) : "—"}
          aside={
            stats.averageWin !== null || stats.averageLoss !== null ? (
              <WinLossBar win={stats.averageWin ?? 0} loss={stats.averageLoss ?? 0} currency={stats.currency} />
            ) : null
          }
        />
        <StatCard
          label={t("dayWin")}
          help={t("dayWinHelp")}
          value={stats.dayWin.rate !== null ? formatPercent(stats.dayWin.rate, 2) : none}
          detail={
            stats.dayWin.rate !== null
              ? t("dayWinDetail", { green: stats.dayWin.greenDays, red: stats.dayWin.redDays })
              : undefined
          }
        />
        <StatCard
          label={t("profitFactor")}
          help={t("profitFactorHelp")}
          value={stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : "—"}
          aside={
            hasTrades ? (
              <div className="flex items-center gap-2">
                <span className="mono text-profit">{money(stats.grossProfit)}</span>
                <Donut positive={stats.grossProfit} negative={stats.grossLoss} size={64} />
                <span className="mono text-loss">-{money(stats.grossLoss)}</span>
              </div>
            ) : null
          }
        />
        <StatCard
          label={t("bestDayShare")}
          help={t("bestDayShareHelp")}
          value={stats.bestDay?.shareOfNet != null ? formatPercent(stats.bestDay.shareOfNet, 2) : "—"}
          detail={
            stats.bestDay
              ? t("bestDayOn", { amount: money(stats.bestDay.netPnl), date: stats.bestDay.date })
              : undefined
          }
        />

        <StatCard
          label={t("mostActive")}
          help={t("mostActiveHelp")}
          value={stats.mostActive ? tDay(stats.mostActive.weekday) : none}
          detail={
            stats.mostActive
              ? t("mostActiveDetail", {
                  days: stats.mostActive.activeDays,
                  trades: stats.mostActive.trades,
                  avg: (stats.mostActive.trades / stats.mostActive.activeDays).toFixed(2),
                })
              : undefined
          }
        />
        <StatCard
          label={t("mostProfitable")}
          help={t("mostProfitableHelp")}
          value={stats.mostProfitable ? tDay(stats.mostProfitable.weekday) : none}
          aside={
            stats.mostProfitable ? (
              <Money value={stats.mostProfitable.netPnl} currency={stats.currency} className="text-sm" />
            ) : null
          }
        />
        <StatCard
          label={t("leastProfitable")}
          help={t("leastProfitableHelp")}
          value={stats.leastProfitable ? tDay(stats.leastProfitable.weekday) : none}
          aside={
            stats.leastProfitable ? (
              <Money value={stats.leastProfitable.netPnl} currency={stats.currency} className="text-sm" />
            ) : null
          }
        />

        <StatCard label={t("tradeCount")} help={t("tradeCountHelp")} value={stats.tradeCount} />
        <StatCard
          label={t("averageR")}
          help={t("averageRHelp")}
          value={formatR(stats.averageR)}
          tone={toneOf(stats.averageR)}
        />
        <StatCard label={t("avgDuration")} help={t("avgDurationHelp")} value={formatDuration(stats.durations.all)} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <StatCard
          label={t("avgWinDuration")}
          help={t("avgWinDurationHelp")}
          value={formatDuration(stats.durations.wins)}
        />
        <StatCard
          label={t("avgLossDuration")}
          help={t("avgLossDurationHelp")}
          value={formatDuration(stats.durations.losses)}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label={t("avgWin")}
          help={t("avgWinHelp")}
          value={stats.averageWin !== null ? money(stats.averageWin) : "—"}
          tone={stats.averageWin !== null ? "profit" : "neutral"}
        />
        <StatCard
          label={t("avgLoss")}
          help={t("avgLossHelp")}
          value={stats.averageLoss !== null ? `-${money(stats.averageLoss)}` : "—"}
          tone={stats.averageLoss !== null ? "loss" : "neutral"}
        />
        <StatCard
          label={t("direction")}
          help={t("directionHelp")}
          value={stats.direction.longShare !== null ? formatPercent(stats.direction.longShare, 2) : none}
          detail={
            hasTrades ? t("directionDetail", { long: stats.direction.long, short: stats.direction.short }) : undefined
          }
          aside={
            hasTrades ? (
              <Donut
                positive={stats.direction.long}
                negative={stats.direction.short}
                positiveTone="profit"
                negativeTone="loss"
                size={64}
              />
            ) : null
          }
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <StatCard
          label={t("best")}
          help={t("bestHelp")}
          value={stats.best ? money(stats.best.netPnl) : "—"}
          tone={stats.best ? "profit" : "neutral"}
          aside={tradeAside(stats.best)}
        />
        <StatCard
          label={t("worst")}
          help={t("worstHelp")}
          value={stats.worst ? money(stats.worst.netPnl) : "—"}
          tone={stats.worst ? "loss" : "neutral"}
          aside={tradeAside(stats.worst)}
        />
      </div>
    </div>
  );
}

/** Average win against average loss as one bar, split in proportion. */
function WinLossBar({ win, loss, currency }: { win: number; loss: number; currency: string }) {
  const total = win + loss;
  const winShare = total > 0 ? (win / total) * 100 : 50;
  return (
    <div className="flex w-40 flex-col gap-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="bg-profit" style={{ width: `${winShare}%` }} />
        <div className="flex-1 bg-loss" />
      </div>
      <div className="flex justify-between gap-2 text-xs">
        <span className="mono text-profit">{formatMoney(win, currency)}</span>
        <span className="mono text-loss">-{formatMoney(loss, currency)}</span>
      </div>
    </div>
  );
}
