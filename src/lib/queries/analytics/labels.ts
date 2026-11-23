import type { DurationBucketKey } from "@/lib/metrics/duration";
import type { Weekday } from "@/lib/metrics/session";

/**
 * Display labels and orderings for the enum-ish keys the breakdowns group by.
 *
 * No `server-only` marker: these are plain constants, and keeping them
 * importable from a client component means a chart legend can label its own
 * axis without the page threading the labels through as props.
 */

export const SESSION_LABELS: Record<string, string> = {
  SYDNEY: "Sydney",
  TOKYO: "Tokyo",
  LONDON: "London",
  NEW_YORK: "New York",
  OVERLAP: "London / NY overlap",
  OFFHOURS: "Off hours",
  UNKNOWN: "Unclassified",
};
export const SESSION_ORDER = ["SYDNEY", "TOKYO", "LONDON", "NEW_YORK", "OVERLAP", "OFFHOURS"];

export const WEEKDAY_LABELS: Record<string, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};
export const WEEKDAY_ORDER: Weekday[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

export const PLAN_LABELS: Record<string, string> = {
  yes: "Followed plan",
  no: "Deviated from plan",
  unset: "Not recorded",
};

/** Labels for the holding-time buckets; the edges themselves are
 * `DURATION_BUCKETS` in lib/metrics/duration.ts. */
export const HOLDING_LABELS: Record<DurationBucketKey, string> = {
  lt15m: "<15m",
  "15m-1h": "15–60m",
  "1h-4h": "1–4h",
  "4h-1d": "4–24h",
  gt1d: ">1d",
};
