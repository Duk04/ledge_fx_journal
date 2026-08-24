import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/metrics/formatters";

/**
 * A trade's price geometry drawn as a small vertical ladder: one axis, a
 * tick for every price that exists (stop, entry, target, actual exit), the
 * risk leg (entry→stop) tinted loss, the reward leg (entry→target) tinted
 * profit. No chart library — this is four numbers and their relationship to
 * each other, which a real chart would bury in candles and gridlines. The
 * axis always runs high-price-at-top regardless of direction, so it reads
 * the way a price chart reads; what makes it a LONG or SHORT is which side
 * (up or down from entry) is coloured as risk vs. reward.
 */
export function PriceLadder({
  direction,
  digits,
  entryPrice,
  stopLoss,
  takeProfit,
  exitPrice,
  className,
}: {
  direction: "LONG" | "SHORT";
  digits: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  exitPrice: number | null;
  className?: string;
}) {
  const WIDTH = 280;
  const HEIGHT = 200;
  const PAD_Y = 28;
  const AXIS_X = 132;

  type Point = { key: string; price: number; label: string; tone: "loss" | "profit" | "neutral" | "exit" };

  const points: Point[] = [{ key: "entry", price: entryPrice, label: "Entry", tone: "neutral" }];
  if (stopLoss !== null) points.push({ key: "stop", price: stopLoss, label: "Stop", tone: "loss" });
  if (takeProfit !== null) points.push({ key: "target", price: takeProfit, label: "Target", tone: "profit" });
  if (exitPrice !== null) {
    const favourable = direction === "LONG" ? exitPrice >= entryPrice : exitPrice <= entryPrice;
    points.push({ key: "exit", price: exitPrice, label: "Exit", tone: favourable ? "profit" : "loss" });
  }

  const values = points.map((p) => p.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(entryPrice) * 0.001 || 1; // a flat set of prices still needs *some* span to draw
  const padSpan = span * 0.18;

  function y(price: number): number {
    const t = (price - (min - padSpan)) / (span + padSpan * 2);
    return PAD_Y + (1 - t) * (HEIGHT - PAD_Y * 2);
  }

  const entryY = y(entryPrice);
  const stopY = stopLoss !== null ? y(stopLoss) : null;
  const targetY = takeProfit !== null ? y(takeProfit) : null;
  const exitY = exitPrice !== null ? y(exitPrice) : null;
  const exitTone = points.find((p) => p.key === "exit")?.tone;

  const toneColor: Record<string, string> = {
    loss: "var(--loss)",
    profit: "var(--profit)",
    neutral: "var(--ink-2)",
    exit: "var(--ink)",
  };

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("w-full max-w-[280px]", className)}
      role="img"
      aria-label={`Price geometry: entry ${formatPrice(entryPrice, digits)}${
        stopLoss !== null ? `, stop ${formatPrice(stopLoss, digits)}` : ""
      }${takeProfit !== null ? `, target ${formatPrice(takeProfit, digits)}` : ""}${
        exitPrice !== null ? `, exit ${formatPrice(exitPrice, digits)}` : ""
      }`}
    >
      {/* axis */}
      <line x1={AXIS_X} y1={PAD_Y} x2={AXIS_X} y2={HEIGHT - PAD_Y} stroke="var(--line-strong)" strokeWidth={1} />

      {/* risk leg: entry -> stop */}
      {stopY !== null ? (
        <line x1={AXIS_X} y1={entryY} x2={AXIS_X} y2={stopY} stroke="var(--loss)" strokeWidth={4} strokeLinecap="round" />
      ) : null}

      {/* reward leg: entry -> target */}
      {targetY !== null ? (
        <line
          x1={AXIS_X}
          y1={entryY}
          x2={AXIS_X}
          y2={targetY}
          stroke="var(--profit)"
          strokeWidth={4}
          strokeLinecap="round"
        />
      ) : null}

      {/* actual exit: a dashed connector back to entry plus its own marker,
          drawn last so it sits on top of the risk/reward legs */}
      {exitY !== null ? (
        <line
          x1={AXIS_X + 14}
          y1={entryY}
          x2={AXIS_X + 14}
          y2={exitY}
          stroke={toneColor[exitTone ?? "neutral"]}
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      ) : null}

      {/* ticks */}
      {points.map((p) => {
        const py = y(p.price);
        const isExit = p.key === "exit";
        return (
          <g key={p.key}>
            <line
              x1={AXIS_X - 6}
              y1={py}
              x2={isExit ? AXIS_X + 20 : AXIS_X + 6}
              y2={py}
              stroke={toneColor[p.tone]}
              strokeWidth={isExit ? 2 : 1.5}
            />
            <circle cx={isExit ? AXIS_X + 14 : AXIS_X} cy={py} r={isExit ? 3.5 : 3} fill={toneColor[p.tone]} />
            <text x={AXIS_X - 12} y={py} textAnchor="end" dominantBaseline="middle" className="mono" fontSize={10} fill="var(--ink)">
              {formatPrice(p.price, digits)}
            </text>
            <text
              x={isExit ? AXIS_X + 26 : AXIS_X + 12}
              y={py}
              textAnchor="start"
              dominantBaseline="middle"
              fontSize={10}
              fill={toneColor[p.tone]}
              fontWeight={isExit ? 600 : 500}
            >
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
