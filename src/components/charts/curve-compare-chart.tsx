"use client";

import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/metrics/formatters";
import { ChartTooltipRow, ChartTooltipShell, ChartTooltipTitle } from "./chart-tooltip";

/**
 * Two (or more) balance paths over trade number, not time — the simulators'
 * curves are sequences of outcomes, and spacing them by date would suggest a
 * timing claim they don't make. The first series is the reference and is
 * drawn quiet; the rest in the brand colour.
 */
export function CurveCompareChart({
  series,
  startBalance,
  currency,
  height = 220,
}: {
  series: { name: string; values: number[]; muted?: boolean }[];
  startBalance: number;
  currency: string;
  height?: number;
}) {
  const t = useTranslations("dashboard.charts.curveCompare");
  const length = Math.max(0, ...series.map((s) => s.values.length));
  const rows = Array.from({ length }, (_, i) => {
    const row: Record<string, number> = { i };
    series.forEach((s, k) => {
      if (i < s.values.length) row[`s${k}`] = s.values[i];
    });
    return row;
  });

  return (
    <div
      role="img"
      aria-label={series
        .map((s) => t("endsAt", { name: s.name, amount: formatMoney(s.values.at(-1) ?? startBalance, currency) }))
        .join("; ")}
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 10, left: 10, bottom: 0 }}>
          <XAxis
            dataKey="i"
            type="number"
            domain={[0, Math.max(1, length - 1)]}
            axisLine={{ stroke: "var(--chart-grid)" }}
            tickLine={false}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            tickFormatter={(i: number) => `#${i}`}
            minTickGap={40}
          />
          <YAxis hide domain={["auto", "auto"]} />
          <ReferenceLine y={startBalance} stroke="var(--chart-grid)" strokeDasharray="3 3" />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltipShell>
                  <ChartTooltipTitle>{t("afterTrade", { n: String(label) })}</ChartTooltipTitle>
                  {payload.map((p) => (
                    <ChartTooltipRow
                      key={String(p.dataKey)}
                      label={series[Number(String(p.dataKey).slice(1))]?.name ?? ""}
                      value={formatMoney(Number(p.value), currency)}
                    />
                  ))}
                </ChartTooltipShell>
              ) : null
            }
          />
          {series.map((s, k) => (
            <Line
              key={k}
              type="monotone"
              dataKey={`s${k}`}
              dot={false}
              isAnimationActive={false}
              stroke={s.muted ? "var(--ink-3)" : "var(--brand)"}
              strokeWidth={s.muted ? 1 : 1.75}
              strokeOpacity={s.muted ? 0.7 : 1}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
