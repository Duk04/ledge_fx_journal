"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { formatMoney, formatMoneyCompact } from "@/lib/metrics/formatters";
import { EmptyState } from "@/components/ui";
import { ChartFrame } from "./chart-frame";
import { ChartTooltipRow, ChartTooltipShell, ChartTooltipTitle } from "./chart-tooltip";

interface DailyPoint {
  date: string;
  value: number;
}

/**
 * End-of-day account balance over the range — one point per day that
 * something happened, opening at the range's first day. Unlike Analytics'
 * EquityChart (a point per trade, cash movements marked) this is the coarse
 * daily picture read alongside the calendar, so it stays neutral-toned with a
 * visible axis: the numbers on it matter more than whether it ended green.
 */
export function DailyBalanceChart({ data, currency }: { data: { date: string; balance: number }[]; currency: string }) {
  const t = useTranslations("journal.stats");
  const points = data.map((p) => ({ date: p.date, value: p.balance }));
  return (
    <DailyLine
      data={points}
      currency={currency}
      seriesLabel={t("balance")}
      label={
        points.length
          ? t("balanceLabel", {
              start: formatMoney(points[0].value, currency),
              end: formatMoney(points[points.length - 1].value, currency),
              count: points.length,
            })
          : ""
      }
    />
  );
}

/**
 * Closed-trade P&L added up day by day, from zero at the start of the range.
 * The balance chart above it moves with deposits and withdrawals too; this
 * one is trading alone, which is why both are on the page. The zero line is
 * drawn because being above or below it is the whole reading.
 */
export function CumulativePnlChart({
  data,
  currency,
}: {
  data: { date: string; cumulative: number }[];
  currency: string;
}) {
  const t = useTranslations("journal.stats");
  const points = data.map((p) => ({ date: p.date, value: p.cumulative }));
  return (
    <DailyLine
      data={points}
      currency={currency}
      seriesLabel={t("cumulative")}
      zeroLine
      label={
        points.length
          ? t("cumulativeLabel", {
              end: formatMoney(points[points.length - 1].value, currency),
              count: points.length,
            })
          : ""
      }
    />
  );
}

/** The line both charts above draw: one value per day, money on the axis. */
function DailyLine({
  data,
  currency,
  label,
  seriesLabel,
  zeroLine = false,
}: {
  data: DailyPoint[];
  currency: string;
  /** The sentence a screen reader gets in place of the picture. */
  label: string;
  /** What the value is called in the tooltip. */
  seriesLabel: string;
  zeroLine?: boolean;
}) {
  const gradientId = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const tEmpty = useTranslations("dashboard.charts.equity");

  if (data.length < 2) {
    return <EmptyState title={tEmpty("emptyTitle")} description={tEmpty("emptyDescription")} />;
  }

  return (
    <ChartFrame label={label}>
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
          {zeroLine ? <ReferenceLine y={0} stroke="var(--line-strong)" /> : null}
          <Tooltip
            cursor={{ stroke: "var(--chart-grid)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as DailyPoint;
              return (
                <ChartTooltipShell>
                  <ChartTooltipTitle>{p.date}</ChartTooltipTitle>
                  <ChartTooltipRow label={seriesLabel} value={formatMoney(p.value, currency)} />
                </ChartTooltipShell>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
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
