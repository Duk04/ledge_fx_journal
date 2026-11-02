import type { Timeframe } from "@prisma/client";

/**
 * Every bar timeframe, finest first — the order candle aggregation and the
 * "higher timeframe" pickers rely on. One list: it was written out in eleven
 * places (four components, a route, five server modules), so adding a
 * timeframe meant finding them all. Plain data, so client components import
 * it as well as server code.
 */
export const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;

/** Compiles only while the list names every timeframe the schema has. */
export type AllTimeframesListed = AssertNever<Exclude<Timeframe, (typeof TIMEFRAMES)[number]>>;
type AssertNever<T extends never> = T;

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && (TIMEFRAMES as readonly string[]).includes(value);
}
