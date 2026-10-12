"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { formatMoney, formatPercent } from "@/lib/metrics/formatters";
import { Tip, EmptyState } from "@/components/ui";
import type { HeatmapCell } from "@/lib/queries/analytics";

const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

function isWeekday(value: string): value is (typeof WEEKDAYS)[number] {
  return (WEEKDAYS as readonly string[]).includes(value);
}

const SESSION_SHORT: Record<string, string> = {
  SYDNEY: "SYD",
  TOKYO: "TOK",
  LONDON: "LON",
  NEW_YORK: "NY",
  OVERLAP: "OVL",
  OFFHOURS: "OFF",
};

/**
 * Weekday x session performance grid — pure CSS/SVG, no chart library
 * (Recharts has no native heatmap primitive worth fighting for a 7x6 grid).
 *
 * Colour-blind safety: magnitude is encoded TWICE — once as a tint (weak
 * profit/loss token, opacity scaled by |netPnl| / the grid's largest
 * |netPnl|) and once as a small solid corner bar whose length scales the
 * same way. A hue-only reading would fail on a green/red confusion; the
 * corner bar's presence/length is legible even in greyscale.
 */
export function SessionHeatmap({ cells, currency }: { cells: HeatmapCell[]; currency: string }) {
  const t = useTranslations("dashboard.charts.heatmap");
  const populated = cells.filter((c) => c.count > 0);
  if (populated.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  const sessions = [...new Set(cells.map((c) => c.session))];
  const weekdays = [...new Set(cells.map((c) => c.weekday))];
  const maxAbs = Math.max(...cells.map((c) => Math.abs(c.netPnl)), 1);

  return (
    <div className="scroll-x">
      <div
        className="grid min-w-[26rem] gap-[3px]"
        style={{ gridTemplateColumns: `3.25rem repeat(${sessions.length}, minmax(0, 1fr))` }}
      >
        <div />
        {sessions.map((s) => (
          <div key={s} className="label pb-1 text-center">
            {SESSION_SHORT[s] ?? s.slice(0, 3)}
          </div>
        ))}
        {weekdays.map((w) => (
          <Row key={w} weekday={w} sessions={sessions} cells={cells} maxAbs={maxAbs} currency={currency} />
        ))}
      </div>
    </div>
  );
}

function Row({
  weekday,
  sessions,
  cells,
  maxAbs,
  currency,
}: {
  weekday: string;
  sessions: string[];
  cells: HeatmapCell[];
  maxAbs: number;
  currency: string;
}) {
  const t = useTranslations("dashboard.charts.heatmap");
  return (
    <>
      <div className="label flex items-center">
        {isWeekday(weekday) ? t(`weekday.${weekday}`) : weekday.slice(0, 3)}
      </div>
      {sessions.map((session) => {
        const cell = cells.find((c) => c.weekday === weekday && c.session === session);
        if (!cell) return <div key={session} />;
        return <HeatCell key={session} cell={cell} maxAbs={maxAbs} currency={currency} />;
      })}
    </>
  );
}

function HeatCell({ cell, maxAbs, currency }: { cell: HeatmapCell; maxAbs: number; currency: string }) {
  const fraction = cell.count === 0 ? 0 : Math.min(1, Math.abs(cell.netPnl) / maxAbs);
  const positive = cell.netPnl >= 0;
  const tone = positive ? "var(--profit)" : "var(--loss)";
  const t = useTranslations("dashboard.charts.heatmap");
  const day = isWeekday(cell.weekday) ? t(`weekday.${cell.weekday}`) : cell.weekday;
  const tl = useTranslations("analytics.labels");
  const sessionKey = `session.${cell.session}` as Parameters<typeof tl>[0];
  const sessionLabel = tl.has(sessionKey) ? tl(sessionKey) : cell.sessionLabel;
  const trades = t("trades", { count: cell.count });

  return (
    <Tip
      label={
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {day} · {sessionLabel}
          </span>
          <span>{trades}</span>
          {cell.count > 0 ? (
            <>
              <span>{t("net", { amount: formatMoney(cell.netPnl, currency) })}</span>
              <span>{t("winRate", { rate: cell.winRate === null ? "—" : formatPercent(cell.winRate) })}</span>
            </>
          ) : null}
        </div>
      }
    >
      {/* The tint is mixed into the background colour rather than applied as
          `opacity` on the cell: opacity would fade the count text and the
          polarity bar along with it, down to ~12% on the faintest cells. The
          cell is focusable so the tooltip is reachable without a mouse. */}
      <div
        tabIndex={0}
        aria-label={`${t("cellAria", { day, session: sessionLabel, trades })}${cell.count > 0 ? t("cellAriaNet", { amount: formatMoney(cell.netPnl, currency) }) : ""}`}
        className="relative flex aspect-square min-h-9 items-center justify-center rounded-inner border border-line-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        style={{
          backgroundColor:
            cell.count === 0
              ? "var(--inset)"
              : `color-mix(in oklab, ${tone} ${Math.round((0.12 + fraction * 0.55) * 100)}%, transparent)`,
        }}
      >
        <span className={cn("mono relative text-2xs tabular-nums", cell.count === 0 ? "text-ink-3" : "text-ink")}>
          {cell.count === 0 ? "–" : cell.count}
        </span>
        {/* Secondary, hue-independent encoding: a neutral bar whose EDGE
            (bottom = profit, top = loss) carries polarity and whose LENGTH
            carries magnitude — legible in greyscale/print/any CVD type,
            where the tint's win/loss hue alone would not be. */}
        {cell.count > 0 ? (
          <span
            aria-hidden
            className={cn("absolute inset-x-0.5 rounded-[1px] bg-ink-2/70", positive ? "bottom-0.5" : "top-0.5")}
            style={{ height: Math.max(2, fraction * 8) }}
          />
        ) : null}
      </div>
    </Tip>
  );
}
