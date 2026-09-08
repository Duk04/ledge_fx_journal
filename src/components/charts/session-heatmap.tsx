"use client";

import { cn } from "@/lib/cn";
import { formatMoney, formatPercent } from "@/lib/metrics/formatters";
import { Tip, EmptyState } from "@/components/ui";
import type { HeatmapCell } from "@/lib/queries/analytics";

const WEEKDAY_SHORT: Record<string, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

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
  const populated = cells.filter((c) => c.count > 0);
  if (populated.length === 0) {
    return <EmptyState title="No trades yet" description="The session heatmap fills in once you log some trades." />;
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
  return (
    <>
      <div className="label flex items-center">{WEEKDAY_SHORT[weekday] ?? weekday.slice(0, 3)}</div>
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

  return (
    <Tip
      label={
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {WEEKDAY_SHORT[cell.weekday] ?? cell.weekday} · {cell.sessionLabel}
          </span>
          <span>
            {cell.count} trade{cell.count === 1 ? "" : "s"}
          </span>
          {cell.count > 0 ? (
            <>
              <span>Net {formatMoney(cell.netPnl, currency)}</span>
              <span>Win rate {cell.winRate === null ? "—" : formatPercent(cell.winRate)}</span>
            </>
          ) : null}
        </div>
      }
    >
      <div
        className="relative flex aspect-square min-h-9 items-center justify-center rounded-[3px] border border-line-faint"
        style={{
          backgroundColor: cell.count === 0 ? "var(--inset)" : tone,
          opacity: cell.count === 0 ? 1 : 0.12 + fraction * 0.55,
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
