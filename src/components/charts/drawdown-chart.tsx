"use client";

import { Area, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { formatMoney, formatPercent } from "@/lib/metrics/formatters";
import { EmptyState } from "@/components/ui";
import { ChartTooltipRow, ChartTooltipShell, ChartTooltipTitle } from "./chart-tooltip";
import type { DrawdownPointDTO } from "@/lib/queries/analytics";

/**
 * The underwater plot: drawdown as a percentage of the high-water mark,
 * plotted negative so it sinks below a zero baseline. Deliberately shares
 * the equity chart's x-domain (both are sliced from the same
 * `equityCurve()` points — see analytics.ts) and is meant to sit directly
 * beneath it with no gap, so the pair reads as one picture rather than two
 * unrelated charts.
 */
export function DrawdownChart({ data, currency }: { data: DrawdownPointDTO[]; currency: string }) {
  if (data.length === 0) {
    return <EmptyState title="No drawdown to show" description="Nothing to plot for this range yet." />;
  }

  const points = data.map((p) => ({ ...p, t: new Date(p.at).getTime(), neg: -p.drawdownPct }));
  const domain: [number, number] = [points[0].t, points[points.length - 1].t];

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={90}>
      <ComposedChart data={points} margin={{ top: 4, right: 10, left: 10, bottom: 0 }}>
        <XAxis
          dataKey="t"
          type="number"
          domain={domain}
          axisLine={{ stroke: "var(--chart-grid)" }}
          tickLine={false}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          tickFormatter={(t: number) => format(new Date(t), "MMM d")}
          minTickGap={40}
        />
        <YAxis hide domain={[(dataMin: number) => Math.min(dataMin, 0), 0]} />
        <Tooltip
          cursor={{ stroke: "var(--chart-grid)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof points)[number];
            return (
              <ChartTooltipShell>
                <ChartTooltipTitle>{format(new Date(p.t), "EEE, MMM d yyyy HH:mm")}</ChartTooltipTitle>
                <ChartTooltipRow
                  label="Drawdown"
                  value={formatPercent(p.drawdownPct / 100)}
                  tone={p.drawdownPct > 0 ? "loss" : "neutral"}
                />
                <ChartTooltipRow label="Amount" value={formatMoney(p.drawdown, currency)} tone="loss" />
              </ChartTooltipShell>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="neg"
          stroke="var(--loss)"
          strokeWidth={1.5}
          fill="var(--loss-weak)"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
