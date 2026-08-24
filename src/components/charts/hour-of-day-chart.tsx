"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/metrics/formatters";
import { EmptyState } from "@/components/ui";
import { ChartTooltipRow, ChartTooltipShell, ChartTooltipTitle } from "./chart-tooltip";
import type { BreakdownRow } from "@/lib/queries/analytics";

/**
 * Net P&L by hour-of-day (local to the account owner's timezone — see
 * analytics.ts's `breakdowns().hourOfDay`), coloured by sign. Rows arrive
 * already in chronological 00:00→23:00 order, not sorted by P&L — a
 * time-of-day chart out of clock order would be unreadable.
 */
export function HourOfDayChart({ rows, currency }: { rows: BreakdownRow[]; currency: string }) {
  const withData = rows.filter((r) => r.count > 0);
  if (withData.length === 0) {
    return <EmptyState title="No trades yet" description="The hour-of-day breakdown fills in once you log some trades." />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={160}>
      <BarChart data={rows} margin={{ top: 8, right: 10, left: 10, bottom: 0 }} barCategoryGap="20%">
        <XAxis
          dataKey="label"
          axisLine={{ stroke: "var(--chart-grid)" }}
          tickLine={false}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis hide />
        <Tooltip
          cursor={{ fill: "var(--hover)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as BreakdownRow;
            return (
              <ChartTooltipShell>
                <ChartTooltipTitle>{r.label}</ChartTooltipTitle>
                <ChartTooltipRow
                  label="Net P&L"
                  value={formatMoney(r.netPnl, currency)}
                  tone={r.netPnl > 0 ? "profit" : r.netPnl < 0 ? "loss" : "neutral"}
                />
                <ChartTooltipRow label="Trades" value={r.count} />
              </ChartTooltipShell>
            );
          }}
        />
        <Bar dataKey="netPnl" radius={[2, 2, 2, 2]} isAnimationActive={false} maxBarSize={18}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.netPnl >= 0 ? "var(--profit)" : "var(--loss)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
