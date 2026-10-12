import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import { fibLevels, type Anchor, type Drawing, type DrawingKind } from "@/lib/backtest/replay-tools";

/**
 * Draws the replay chart's drawings and position tool onto the price pane,
 * through lightweight-charts' series-primitive API. The library has no
 * drawing tools of its own; this is the canvas half of
 * lib/backtest/replay-tools.ts.
 *
 * It only RENDERS and HIT-TESTS. Which tool is active, clicks, drags and the
 * list itself are React state in CandlestickChart. That component hands a
 * fresh `Scene` over on every change, and the chart repaints.
 */

export interface SceneColors {
  ink: string;
  ink3: string;
  brand: string;
  profit: string;
  loss: string;
  warn: string;
  panel: string;
}

export interface PositionScene {
  side: "LONG" | "SHORT";
  entry: number;
  stop: number | null;
  target: number | null;
  /** Bar index the zones start at. */
  fromIndex: number;
  valid: boolean;
  stopLabel: string;
  targetLabel: string;
}

export interface Scene {
  drawings: Drawing[];
  selectedId: string | null;
  /** The drawing being placed: first click done, second following the mouse. */
  draft: { kind: DrawingKind; a: Anchor; b: Anchor } | null;
  position: PositionScene | null;
  colors: SceneColors;
}

/** How far right a position tool's zones reach, in bars. */
const POSITION_WIDTH_BARS = 24;
const HIT_PX = 6;

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setScene(scene: Scene) {
    this.scene = scene;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "top", renderer: () => this.renderer }];
  }

  // ------------------------------------------------------------ geometry
  x(i: number): number | null {
    return this.chart?.timeScale().logicalToCoordinate(i as Logical) ?? null;
  }

  y(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  /** The drawing under a point, nearest first; null when nothing is within
   * a few pixels. Media (CSS) pixels, the same space mouse events use. */
  drawingAt(px: number, py: number): string | null {
    for (const d of [...this.scene.drawings].reverse()) {
      if (this.hits(d, px, py)) return d.id;
    }
    return null;
  }

  /** Which of the position tool's lines is under `py`, for dragging. */
  positionHandleAt(py: number): "stop" | "target" | null {
    const p = this.scene.position;
    if (!p) return null;
    const near = (price: number | null) => {
      if (price === null) return false;
      const y = this.y(price);
      return y !== null && Math.abs(y - py) <= HIT_PX;
    };
    if (near(p.stop)) return "stop";
    if (near(p.target)) return "target";
    return null;
  }

  private hits(d: Drawing, px: number, py: number): boolean {
    const xa = this.x(d.a.i);
    const ya = this.y(d.a.price);
    if (ya === null) return false;
    if (d.kind === "hline") return Math.abs(py - ya) <= HIT_PX;
    if (!d.b || xa === null) return false;
    const xb = this.x(d.b.i);
    const yb = this.y(d.b.price);
    if (xb === null || yb === null) return false;
    if (d.kind === "trend") return distanceToSegment(px, py, xa, ya, xb, yb) <= HIT_PX;
    const left = Math.min(xa, xb) - HIT_PX;
    const right = Math.max(xa, xb) + HIT_PX;
    if (d.kind === "rect") {
      const top = Math.min(ya, yb) - HIT_PX;
      const bottom = Math.max(ya, yb) + HIT_PX;
      return px >= left && px <= right && py >= top && py <= bottom;
    }
    // fib: any level line within its horizontal span
    if (px < left) return false;
    return fibLevels(d.a, d.b).some((l) => {
      const y = this.y(l.price);
      return y !== null && Math.abs(py - y) <= HIT_PX;
    });
  }

  // ------------------------------------------------------------ painting
  private renderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) => {
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        const { drawings, draft, position, selectedId, colors } = this.scene;
        ctx.save();
        ctx.font = "11px var(--font-instrument-sans), sans-serif";
        ctx.textBaseline = "middle";
        if (position) this.paintPosition(ctx, mediaSize.width, position, colors);
        for (const d of drawings) this.paint(ctx, mediaSize.width, d, colors, d.id === selectedId);
        if (draft) this.paint(ctx, mediaSize.width, { id: "draft", ...draft }, colors, false, true);
        ctx.restore();
      });
    },
  };

  private paint(
    ctx: CanvasRenderingContext2D,
    width: number,
    d: Drawing,
    c: SceneColors,
    selected: boolean,
    draft = false,
  ) {
    const xa = this.x(d.a.i);
    const ya = this.y(d.a.price);
    if (ya === null) return;
    ctx.strokeStyle = c.brand;
    ctx.fillStyle = c.brand;
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.setLineDash(draft ? [4, 3] : []);

    if (d.kind === "hline") {
      line(ctx, 0, ya, width, ya);
      if (selected) handle(ctx, xa ?? width - 12, ya, c);
      return;
    }
    if (!d.b || xa === null) return;
    const xb = this.x(d.b.i);
    const yb = this.y(d.b.price);
    if (xb === null || yb === null) return;

    if (d.kind === "trend") {
      line(ctx, xa, ya, xb, yb);
    } else if (d.kind === "rect") {
      ctx.globalAlpha = 0.12;
      ctx.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
      ctx.globalAlpha = 1;
      ctx.strokeRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
    } else {
      const left = Math.min(xa, xb);
      // Levels run on past the second point: where they matter is ahead.
      const right = Math.max(width - 60, Math.max(xa, xb));
      ctx.setLineDash([]);
      ctx.strokeStyle = c.ink3;
      line(ctx, xa, ya, xb, yb);
      for (const l of fibLevels(d.a, d.b)) {
        const y = this.y(l.price);
        if (y === null) continue;
        ctx.strokeStyle = l.level === 0 || l.level === 1 ? c.ink3 : c.brand;
        ctx.globalAlpha = l.level === 0.5 || l.level === 0.618 ? 1 : 0.7;
        line(ctx, left, y, right, y);
        ctx.globalAlpha = 1;
        ctx.fillStyle = c.ink3;
        ctx.fillText(String(l.level), right + 4, y);
      }
    }
    if (selected) {
      handle(ctx, xa, ya, c);
      handle(ctx, xb, yb, c);
    }
  }

  private paintPosition(ctx: CanvasRenderingContext2D, width: number, p: PositionScene, c: SceneColors) {
    const x0 = this.x(p.fromIndex);
    const yEntry = this.y(p.entry);
    if (x0 === null || yEntry === null) return;
    const x1 = Math.min(width, this.x(p.fromIndex + POSITION_WIDTH_BARS) ?? width);
    const w = Math.max(24, x1 - x0);

    const zone = (price: number | null, color: string, label: string) => {
      if (price === null) return;
      const y = this.y(price);
      if (y === null) return;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = color;
      ctx.fillRect(x0, Math.min(y, yEntry), w, Math.abs(y - yEntry));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      line(ctx, x0, y, x0 + w, y);
      // A grip, so the line reads as draggable.
      ctx.fillStyle = color;
      ctx.fillRect(x0 + w / 2 - 10, y - 2, 20, 4);
      if (label) pill(ctx, label, x0, x0 + w, y + (y < yEntry ? -10 : 10), c);
    };

    zone(p.target, p.valid ? c.profit : c.warn, p.targetLabel);
    zone(p.stop, p.valid ? c.loss : c.warn, p.stopLabel);
    ctx.strokeStyle = c.ink3;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    line(ctx, x0, yEntry, x0 + w, yEntry);
    ctx.setLineDash([]);
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** A label on a panel-coloured backing, inside the zone when it fits and
 * just left of it when it does not (the zone hugs the right edge). */
function pill(ctx: CanvasRenderingContext2D, text: string, x0: number, x1: number, y: number, c: SceneColors) {
  const width = ctx.measureText(text).width + 10;
  const left = x0 + 4 + width <= x1 ? x0 + 4 : x0 - 4 - width;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = c.panel;
  ctx.fillRect(left, y - 8, width, 16);
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.ink;
  ctx.fillText(text, left + 5, y);
}

function handle(ctx: CanvasRenderingContext2D, x: number, y: number, c: SceneColors) {
  ctx.setLineDash([]);
  ctx.fillStyle = c.panel;
  ctx.strokeStyle = c.brand;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
