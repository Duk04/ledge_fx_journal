"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar, SimPosition } from "@/lib/backtest/types";
import { pointsFor, type Anchor, type Drawing, type DrawingKind } from "@/lib/backtest/replay-tools";
import { DrawingsPrimitive, type PositionScene, type Scene } from "./drawings-primitive";

/**
 * lightweight-charts paints on a `<canvas>`, so it cannot consume Tailwind
 * classes or `var(--token)` strings the way the rest of the app's chrome
 * does — the library wants resolved colour strings. This reads them off
 * `document.documentElement` via `getComputedStyle` instead of hard-coding
 * hex values, so the chart still follows the app's real tokens (and the
 * light/dark swap) rather than a second, drifting copy of the palette.
 */
export function readTokens() {
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

export type ChartTool = DrawingKind | "cursor";

/** Everything the main replay chart needs to be drawn on. The higher-
 * timeframe chart passes none of it and stays read-only. */
export interface ChartTools {
  tool: ChartTool;
  drawings: Drawing[];
  selectedId: string | null;
  onAddDrawing: (d: Omit<Drawing, "id">) => void;
  onSelect: (id: string | null) => void;
  /** The position tool (or the open position) drawn as risk/reward zones. */
  position: PositionScene | null;
  /** Dragging the stop or target line. */
  onDragPosition?: (handle: "stop" | "target", price: number) => void;
}

export function CandlestickChart({
  bars,
  digits,
  position,
  pendingStop,
  pendingTarget,
  tools,
  className,
}: {
  bars: readonly Bar[];
  digits: number;
  position: SimPosition | null;
  /** Draft stop/target from an order the user is still composing, previewed
   * on the chart before it's actually submitted. */
  pendingStop?: number;
  pendingTarget?: number;
  tools?: ChartTools;
  className?: string;
}) {
  const t = useTranslations("backtest.chart");
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = React.useRef<IPriceLine[]>([]);
  const primitiveRef = React.useRef<DrawingsPrimitive | null>(null);
  // Bumped on a theme change so the scene re-reads the colour tokens.
  const [sceneTick, setSceneTick] = React.useState(0);
  // The first click of a two-click drawing, and where the mouse is now.
  const [draft, setDraft] = React.useState<{ kind: DrawingKind; a: Anchor; b: Anchor } | null>(null);
  // Chart event handlers are subscribed once, at mount; they read the
  // latest props and draft through these refs instead of re-subscribing.
  const toolsRef = React.useRef(tools);
  const draftRef = React.useRef(draft);
  React.useEffect(() => {
    toolsRef.current = tools;
    draftRef.current = draft;
  });

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
      // Room right of the last bar: the position tool's zones and any line
      // drawn "into the future" need somewhere to be.
      timeScale: { borderColor: tokens.line, timeVisible: true, secondsVisible: false, rightOffset: 16 },
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

    const primitive = new DrawingsPrimitive(emptyScene());
    series.attachPrimitive(primitive);
    primitiveRef.current = primitive;

    /** A point in the price pane (not on an axis) as a bar index + price. */
    const anchorAt = (x: number, y: number): Anchor | null => {
      const paneRight = container.clientWidth - chart.priceScale("right").width();
      const paneBottom = container.clientHeight - chart.timeScale().height();
      if (x < 0 || y < 0 || x > paneRight || y > paneBottom) return null;
      const logical = chart.timeScale().coordinateToLogical(x);
      const price = series.coordinateToPrice(y);
      return logical === null || price === null ? null : { i: Math.round(logical), price };
    };

    // Clicks come from our own pointer events, not chart.subscribeClick:
    // the library delivers its click late, so a quick second click, or a
    // tool shortcut pressed right after, landed against the wrong tool.
    function onClick(x: number, y: number) {
      const tl = toolsRef.current;
      if (!tl) return;
      if (tl.tool === "cursor") {
        if (anchorAt(x, y)) tl.onSelect(primitive.drawingAt(x, y));
        return;
      }
      const at = anchorAt(x, y);
      if (!at) return;
      const pending = draftRef.current;
      if (pointsFor(tl.tool) === 1) {
        tl.onAddDrawing({ kind: tl.tool, a: at });
      } else if (!pending) {
        setDraft({ kind: tl.tool, a: at, b: at });
      } else {
        tl.onAddDrawing({ kind: pending.kind, a: pending.a, b: at });
        setDraft(null);
      }
    }

    function onMove(param: MouseEventParams<Time>) {
      const pending = draftRef.current;
      if (!pending || !param.point) return;
      const at = anchorAt(param.point.x, param.point.y);
      if (at) setDraft({ ...pending, b: at });
    }

    chart.subscribeCrosshairMove(onMove);

    // Dragging the position tool's stop/target. Pointer events fire before
    // the chart's own mouse handlers, so turning scroll/scale off here stops
    // the drag from also panning the chart.
    let dragging: "stop" | "target" | null = null;
    // Where a press started: a release within a few pixels is a click, a
    // longer travel was a pan and draws nothing.
    let pressAt: { x: number; y: number } | null = null;
    function local(e: PointerEvent) {
      const r = container!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function localY(e: PointerEvent) {
      return local(e).y;
    }
    function onPointerDown(e: PointerEvent) {
      if (e.button === 0) pressAt = local(e);
      if (!toolsRef.current?.onDragPosition) return;
      const handle = primitive.positionHandleAt(localY(e));
      if (!handle) return;
      dragging = handle;
      chart.applyOptions({ handleScroll: false, handleScale: false });
      container!.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      const y = localY(e);
      if (dragging) {
        const price = series.coordinateToPrice(y);
        if (price !== null) toolsRef.current?.onDragPosition?.(dragging, price);
        return;
      }
      const tl = toolsRef.current;
      if (!tl) return;
      container!.style.cursor =
        tl.onDragPosition && primitive.positionHandleAt(y) ? "ns-resize" : tl.tool === "cursor" ? "" : "crosshair";
    }
    function onPointerUp(e: PointerEvent) {
      const start = pressAt;
      pressAt = null;
      if (!dragging) {
        const end = local(e);
        if (start && e.type === "pointerup" && Math.hypot(end.x - start.x, end.y - start.y) <= 4) onClick(end.x, end.y);
        return;
      }
      dragging = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      if (container!.hasPointerCapture(e.pointerId)) container!.releasePointerCapture(e.pointerId);
    }
    container.addEventListener("pointerdown", onPointerDown, { capture: true });
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);

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
      setSceneTick((n) => n + 1);
    }
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", applyTheme);

    return () => {
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      chart.unsubscribeCrosshairMove(onMove);
      media.removeEventListener("change", applyTheme);
      observer.disconnect();
      primitiveRef.current = null;
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

  // -------------------------------------------------------------- drawings
  // A tool change abandons a half-placed drawing (Esc, or picking another).
  const activeTool = tools?.tool;
  const [draftTool, setDraftTool] = React.useState(activeTool);
  if (draftTool !== activeTool) {
    setDraftTool(activeTool);
    setDraft(null);
  }

  React.useEffect(() => {
    const primitive = primitiveRef.current;
    if (!primitive) return;
    const c = readTokens();
    const scene: Scene = {
      drawings: tools?.drawings ?? [],
      selectedId: tools?.selectedId ?? null,
      draft,
      position: tools?.position ?? null,
      colors: {
        ink: c.ink,
        ink3: c.ink3,
        brand: c.brand,
        profit: c.profit,
        loss: c.loss,
        warn: c.warn,
        panel: c.panel,
      },
    };
    primitive.setScene(scene);
  }, [tools?.drawings, tools?.selectedId, tools?.position, draft, sceneTick, digits]);

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

    // The position tool draws its own zones; plain lines would double them.
    if (tools?.position) return;
    if (position) {
      add(position.entryPrice, tokens.brand, t("entry"), false);
      if (position.stopLoss !== undefined) add(position.stopLoss, tokens.loss, t("stop"), true);
      if (position.takeProfit !== undefined) add(position.takeProfit, tokens.profit, t("target"), true);
    } else {
      if (pendingStop !== undefined) add(pendingStop, tokens.loss, t("stopDraft"), true);
      if (pendingTarget !== undefined) add(pendingTarget, tokens.profit, t("targetDraft"), true);
    }
  }, [position, pendingStop, pendingTarget, t, tools?.position]);

  return <div ref={containerRef} className={className} />;
}

function emptyScene(): Scene {
  const c = { ink: "", ink3: "", brand: "", profit: "", loss: "", warn: "", panel: "" };
  return { drawings: [], selectedId: null, draft: null, position: null, colors: c };
}
