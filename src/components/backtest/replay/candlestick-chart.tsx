"use client";

import * as React from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar, SimPosition } from "@/lib/backtest/types";

/**
 * lightweight-charts paints on a `<canvas>`, so it cannot consume Tailwind
 * classes or `var(--token)` strings the way the rest of the app's chrome
 * does — the library wants resolved colour strings. This reads them off
 * `document.documentElement` via `getComputedStyle` instead of hard-coding
 * hex values, so the chart still follows the app's real tokens (and the
 * light/dark swap) rather than a second, drifting copy of the palette.
 */
function readTokens() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    panel: v("--panel") || "#0d1015",
    ink: v("--ink") || "#e9ecf1",
    ink3: v("--ink-3") || "#6b7480",
    line: v("--line") || "#1b2027",
    profit: v("--profit") || "#35c08f",
    loss: v("--loss") || "#c0402a",
    brand: v("--brand") || "#6c86f5",
    warn: v("--warn") || "#e0a93b",
  };
}

export interface CandlestickChartHandle {
  scrollToRealTime: () => void;
}

export function CandlestickChart({
  bars,
  digits,
  position,
  pendingStop,
  pendingTarget,
  className,
}: {
  bars: readonly Bar[];
  digits: number;
  position: SimPosition | null;
  /** Draft stop/target from an order the user is still composing, previewed
   * on the chart before it's actually submitted. */
  pendingStop?: number;
  pendingTarget?: number;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = React.useRef<IPriceLine[]>([]);

  // -------------------------------------------------------------- mount
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const tokens = readTokens();

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: tokens.ink3,
        fontFamily: "var(--font-instrument-sans), sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: tokens.line },
        horzLines: { color: tokens.line },
      },
      rightPriceScale: { borderColor: tokens.line },
      timeScale: { borderColor: tokens.line, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: tokens.profit,
      downColor: tokens.loss,
      borderVisible: false,
      wickUpColor: tokens.profit,
      wickDownColor: tokens.loss,
      priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Re-theme on a light/dark toggle: an explicit `data-theme` attribute
    // flip, or (in "system" mode, no attribute) the OS preference changing.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function applyTheme() {
      const t = readTokens();
      chart.applyOptions({
        layout: { textColor: t.ink3 },
        grid: { vertLines: { color: t.line }, horzLines: { color: t.line } },
        rightPriceScale: { borderColor: t.line },
        timeScale: { borderColor: t.line },
      });
      series.applyOptions({ upColor: t.profit, downColor: t.loss, wickUpColor: t.profit, wickDownColor: t.loss });
    }
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", applyTheme);

    return () => {
      media.removeEventListener("change", applyTheme);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // digits affects priceFormat, which is cheap enough to just remount for.
  }, [digits]);

  // -------------------------------------------------------------- data
  React.useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(
      bars.map((b) => ({
        time: Math.floor(b.ts / 1000) as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );
    chartRef.current?.timeScale().scrollToRealTime();
  }, [bars]);

  // -------------------------------------------------------------- price lines
  React.useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const tokens = readTokens();

    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];

    function add(price: number, color: string, title: string, dashed: boolean) {
      if (!series) return;
      const line = series.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: dashed ? 2 : 0,
        axisLabelVisible: true,
        title,
      });
      priceLinesRef.current.push(line);
    }

    if (position) {
      add(position.entryPrice, tokens.brand, "entry", false);
      if (position.stopLoss !== undefined) add(position.stopLoss, tokens.loss, "stop", true);
      if (position.takeProfit !== undefined) add(position.takeProfit, tokens.profit, "target", true);
    } else {
      if (pendingStop !== undefined) add(pendingStop, tokens.loss, "stop (draft)", true);
      if (pendingTarget !== undefined) add(pendingTarget, tokens.profit, "target (draft)", true);
    }
  }, [position, pendingStop, pendingTarget]);

  return <div ref={containerRef} className={className} />;
}
