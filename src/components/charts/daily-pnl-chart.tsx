"use client";

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";
import { formatMoney } from "@/lib/metrics/formatters";
import { EmptyState } from "@/components/ui";
import { ChartFrame } from "./chart-frame";
import { ChartTooltipRow, ChartTooltipShell, ChartTooltipTitle } from "./chart-tooltip";

export interface DailyPnlPoint {
  date: string;
  netPnl: number;
  tradeCount: number;
}

/** One bar per calendar day, coloured by sign — the coarsest-grain "am I up or down today" read in the app. */
export function DailyPnlChart({ data, currency }: { data: DailyPnlPoint[]; currency: string }) {
  if (data.length === 0) {
    return <EmptyState title="No closed trades yet" description="Daily P&L fills in once trades close." />;
  }

  return (
    <ChartFrame label={dailyLabel(data, currency)}>
      <ResponsiveContainer width="100%" height="100%" minHeight={160}>
        <BarChart data={data} margin={{ top: 8, right: 10, left: 10, bottom: 0 }} barCategoryGap="28%">
          <XAxis
            dataKey="date"
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
            minTickGap={30}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--hover)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as DailyPnlPoint;
              return (
                <ChartTooltipShell>
                  <ChartTooltipTitle>{format(parseISO(p.date), "EEE, MMM d yyyy")}</ChartTooltipTitle>
                  <ChartTooltipRow
                    label="Net P&L"
                    value={formatMoney(p.netPnl, currency)}
                    tone={p.netPnl > 0 ? "profit" : p.netPnl < 0 ? "loss" : "neutral"}
                  />
                  <ChartTooltipRow label="Trades" value={p.tradeCount} />
                </ChartTooltipShell>
              );
            }}
          />
          <ReferenceLine y={0} stroke="var(--chart-grid)" />
          <Bar dataKey="netPnl" radius={[2, 2, 2, 2]} isAnimationActive={false} maxBarSize={20}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.netPnl >= 0 ? "var(--profit)" : "var(--loss)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function dailyLabel(data: DailyPnlPoint[], currency: string) {
  if (!data.length) return "Daily P&L: no closed trades.";
  const best = data.reduce((a, b) => (b.netPnl > a.netPnl ? b : a));
  const worst = data.reduce((a, b) => (b.netPnl < a.netPnl ? b : a));
  const green = data.filter((d) => d.netPnl > 0).length;
  return `Daily P&L over ${data.length} day(s), ${green} green. Best ${best.date} ${formatMoney(best.netPnl, currency)}, worst ${worst.date} ${formatMoney(worst.netPnl, currency)}.`;
}
