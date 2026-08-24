"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/metrics/formatters";
import { EmptyState } from "@/components/ui";
import { ChartTooltipRow, ChartTooltipShell, ChartTooltipTitle } from "./chart-tooltip";
import type { RHistogramBucket } from "@/lib/queries/analytics";

/**
 * Frequency histogram of R multiples: bar height is trade COUNT (the
 * classic "shape of my R distribution" read), not net P&L — a bucket with
 * one huge winner shouldn't dwarf a bucket with ten small ones on this
 * chart. Colour still comes from the bucket's sign so the losing tail and
 * winning tail are visually distinct at a glance. The "no stop loss"
 * bucket is a materially different kind of row (R literally cannot be
 * computed, not just "was zero"), so it renders in flat `--ink-3` rather
 * than borrowing profit/loss coloring, with its own label.
 */
export function RHistogram({ buckets, currency }: { buckets: RHistogramBucket[]; currency: string }) {
  const withData = buckets.filter((b) => b.count > 0);
  if (withData.length === 0) {
    return <EmptyState title="No closed trades yet" description="The R distribution fills in once trades close." />;
  }

  const data = buckets.map((b) => ({
    ...b,
    label: b.from === null ? "No stop" : formatBoundary(b.from),
    isNoR: b.from === null,
    isLoss: b.from !== null && b.from < 0,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={180}>
      <BarChart data={data} margin={{ top: 8, right: 10, left: 10, bottom: 0 }} barCategoryGap="18%">
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
            const b = payload[0].payload as (typeof data)[number];
            return (
              <ChartTooltipShell>
                <ChartTooltipTitle>
                  {b.from === null ? "No stop loss recorded" : `${formatBoundary(b.from)}R to ${formatBoundary(b.to!)}R`}
                </ChartTooltipTitle>
                <ChartTooltipRow label="Trades" value={b.count} />
                <ChartTooltipRow
                  label="Net P&L"
                  value={formatMoney(b.netPnl, currency)}
                  tone={b.netPnl > 0 ? "profit" : b.netPnl < 0 ? "loss" : "neutral"}
                />
              </ChartTooltipShell>
            );
          }}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={36}>
          {data.map((b, i) => (
            <Cell
              key={i}
              fill={b.isNoR ? "var(--ink-3)" : b.isLoss ? "var(--loss)" : "var(--profit)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function formatBoundary(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
