"use client";

import * as React from "react";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { readTokens } from "@/components/backtest/replay/candlestick-chart";
import type { Bar } from "@/lib/backtest/types";
import type { TradeExecution } from "@/lib/queries/trades";

/**
 * A trade on its chart: the candles around it, every fill as a marker, and
 * the initial stop, current stop and target as lines. Bars come from the
 * shared candle store (Backtest → Data); without them the page shows a hint
 * instead of this component.
 */
export function TradeChart({
  bars,
  digits,
  direction,
  executions,
  stopLoss,
  initialStopLoss,
  takeProfit,
}: {
  bars: Bar[];
  digits: number;
  direction: "LONG" | "SHORT";
  executions: TradeExecution[];
  stopLoss: number | null;
  initialStopLoss: number | null;
  takeProfit: number | null;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const t = readTokens();
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: t.ink3, fontSize: 11 },
      grid: { vertLines: { color: t.line }, horzLines: { color: t.line } },
      rightPriceScale: { borderColor: t.line },
      timeScale: { borderColor: t.line, timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: t.profit,
      downColor: t.loss,
      borderVisible: false,
      wickUpColor: t.profit,
      wickDownColor: t.loss,
      priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits },
    });
    series.setData(
      bars.map((b) => ({
        time: Math.floor(b.ts / 1000) as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    // A marker needs a bar time: snap each fill to the bar it falls in.
    const barTimes = bars.map((b) => Math.floor(b.ts / 1000));
    const snap = (iso: string) => {
      const s = Math.floor(new Date(iso).getTime() / 1000);
      let best = barTimes[0];
      for (const bt of barTimes) if (bt <= s) best = bt;
      return best as UTCTimestamp;
    };
    const buy = (kind: "ENTRY" | "EXIT") => (direction === "LONG") === (kind === "ENTRY");
    const markers: SeriesMarker<UTCTimestamp>[] = executions
      .map((e) => ({
        time: snap(e.executedAt),
        position: buy(e.kind) ? ("belowBar" as const) : ("aboveBar" as const),
        shape: buy(e.kind) ? ("arrowUp" as const) : ("arrowDown" as const),
        color: e.kind === "ENTRY" ? t.brand : t.ink,
        text: `${e.kind === "ENTRY" ? "In" : "Out"} ${e.volumeLots} @ ${Number(e.price).toFixed(digits)}`,
      }))
      .sort((a, b) => a.time - b.time);
    createSeriesMarkers(series, markers);

    const line = (price: number | null, title: string, color: string, style: LineStyle) => {
      if (price !== null)
        series.createPriceLine({ price, title, color, lineStyle: style, lineWidth: 1, axisLabelVisible: true });
    };
    line(takeProfit, "TP", t.profit, LineStyle.Dashed);
    line(stopLoss, "SL", t.loss, LineStyle.Dashed);
    if (initialStopLoss !== null && initialStopLoss !== stopLoss)
      line(initialStopLoss, "Initial SL", t.loss, LineStyle.Dotted);

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, digits, direction, executions, stopLoss, initialStopLoss, takeProfit]);

  return (
    <div
      ref={ref}
      className="h-72 w-full"
      role="img"
      aria-label={`Price chart around the trade: ${bars.length} bars, ${executions.length} fill(s) marked.`}
    />
  );
}
