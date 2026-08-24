"use client";

import * as React from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { formatMoney } from "@/lib/metrics/formatters";
import { EmptyState } from "@/components/ui";
import { ChartTooltipRow, ChartTooltipShell, ChartTooltipTitle } from "./chart-tooltip";
import type { EquityPointDTO } from "@/lib/queries/analytics";

const CASH_LABEL: Record<string, string> = {
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  ADJUSTMENT: "Adjustment",
};

/**
 * The hero chart: account equity over the selected range. A single soft
 * area fill under the balance line, toned by whether the window ended up or
 * down against `startBalance` — never a fixed brand colour, because "up" and
 * "down" is the only thing this chart is here to say at a glance.
 *
 * Deposits/withdrawals/adjustments get their own vertical tick instead of
 * folding invisibly into the line: a curve that goes up because someone
 * wired in $10k reads as trading skill unless the cash movement is visible,
 * which is exactly the lie this component exists to not tell.
 */
export function EquityChart({
  data,
  startBalance,
  currency,
  showXAxis = true,
}: {
  data: EquityPointDTO[];
  startBalance: number;
  currency: string;
  /** Hidden when this chart is stacked directly above a DrawdownChart sharing its x-domain — the axis lives on the bottom chart only, so the pair reads as one picture. */
  showXAxis?: boolean;
}) {
  // Hooks must run unconditionally, before the empty-state early return.
  const gradientId = React.useId().replace(/[^a-zA-Z0-9]/g, "");

  if (data.length === 0) {
    return (
      <EmptyState
        title="No activity in this range"
        description="Trades and cash movements will plot here once there's something to show."
      />
    );
  }

  const points = data.map((p) => ({ ...p, t: new Date(p.at).getTime() }));
  const last = points[points.length - 1].balance;
  const up = last >= startBalance;
  const tone = up ? "var(--profit)" : "var(--loss)";
  const domain: [number, number] = [points[0].t, points[points.length - 1].t];

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={180}>
      <ComposedChart data={points} margin={{ top: 8, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity={0.16} />
            <stop offset="100%" stopColor={tone} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="t"
          type="number"
          domain={domain}
          hide={!showXAxis}
          axisLine={{ stroke: "var(--chart-grid)" }}
          tickLine={false}
          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
          tickFormatter={(t: number) => format(new Date(t), "MMM d")}
          minTickGap={40}
        />
        <YAxis
          hide
          domain={[
            (dataMin: number) => Math.min(dataMin, startBalance),
            (dataMax: number) => Math.max(dataMax, startBalance),
          ]}
        />
        <ReferenceLine
          y={startBalance}
          stroke="var(--ink-3)"
          strokeDasharray="3 3"
          strokeWidth={1}
          ifOverflow="extendDomain"
        />
        <Tooltip
          cursor={{ stroke: "var(--chart-grid)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof points)[number];
            const cashLabel = p.kind === "TRADE" ? null : CASH_LABEL[p.kind];
            return (
              <ChartTooltipShell>
                <ChartTooltipTitle>{format(new Date(p.t), "EEE, MMM d yyyy HH:mm")}</ChartTooltipTitle>
                <ChartTooltipRow label="Balance" value={formatMoney(p.balance, currency)} />
                <ChartTooltipRow
                  label={cashLabel ?? "Trade close"}
                  value={`${p.change >= 0 ? "+" : ""}${formatMoney(p.change, currency)}`}
                  tone={p.change > 0 ? "profit" : p.change < 0 ? "loss" : "neutral"}
                />
              </ChartTooltipShell>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke="none"
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="balance"
          stroke={tone}
          strokeWidth={2}
          dot={<CashMarker />}
          activeDot={{ r: 3, fill: tone, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Renders nothing for an ordinary trade-close point; a short warn-toned
 * tick for a deposit/withdrawal/adjustment, so a cash movement is visible on
 * the line itself, not just buried in the tooltip. */
function CashMarker(props: unknown) {
  const { cx, cy, payload } = props as { cx: number; cy: number; payload: { kind: string } };
  if (payload.kind === "TRADE" || cx == null || cy == null) return <React.Fragment />;
  return (
    <line
      x1={cx}
      x2={cx}
      y1={cy - 7}
      y2={cy + 7}
      stroke="var(--warn)"
      strokeWidth={2}
      strokeLinecap="round"
    />
  );
}
