"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { formatMoney, formatMoneyCompact } from "@/lib/metrics/formatters";
import { EmptyState } from "@/components/ui";
import { ChartFrame } from "./chart-frame";
import { ChartTooltipRow, ChartTooltipShell, ChartTooltipTitle } from "./chart-tooltip";

/**
 * End-of-day account balance over the journal's range — one point per day
 * that something happened, opening at the range's first day. Unlike the
 * Overview's EquityChart (a point per trade, cash movements marked) this is
 * the coarse daily picture the journal reads alongside its calendar, so it
 * stays neutral-toned with a visible axis: the numbers on it matter more
 * than whether it ended green.
 */
export function DailyBalanceChart({ data, currency }: { data: { date: string; balance: number }[]; currency: string }) {
  const gradientId = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const t = useTranslations("journal.stats");
  const tEmpty = useTranslations("dashboard.charts.equity");

  if (data.length < 2) {
    return <EmptyState title={tEmpty("emptyTitle")} description={tEmpty("emptyDescription")} />;
  }

  return (
    <ChartFrame
      label={t("balanceLabel", {
        start: formatMoney(data[0].balance, currency),
        end: formatMoney(data[data.length - 1].balance, currency),
        count: data.length,
      })}
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={220}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ink-2)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--ink-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
            minTickGap={24}
          />
          <YAxis
            width={64}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
            domain={["auto", "auto"]}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-grid)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { date: string; balance: number };
              return (
                <ChartTooltipShell>
                  <ChartTooltipTitle>{p.date}</ChartTooltipTitle>
                  <ChartTooltipRow label={t("balance")} value={formatMoney(p.balance, currency)} />
                </ChartTooltipShell>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="var(--ink-2)"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={{ r: 2.5, fill: "var(--panel)", stroke: "var(--ink-2)", strokeWidth: 1 }}
            activeDot={{ r: 3.5, fill: "var(--ink-2)", strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
