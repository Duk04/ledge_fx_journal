/**
 * Trading-session and calendar helpers. All session ranges are UTC hours and
 * are exported as constants so they can be tuned without touching the
 * classification logic below.
 */
import { TZDate } from "@date-fns/tz";

export type MarketSession = "SYDNEY" | "TOKYO" | "LONDON" | "NEW_YORK" | "OVERLAP" | "OFFHOURS";

/**
 * [start, end) UTC hour ranges for each session. Sydney wraps past midnight
 * (21 -> 6). OVERLAP is the London/New York overlap window and is listed
 * separately (rather than derived) so it can be tuned independently.
 */
export const SESSION_RANGES_UTC = {
  SYDNEY: [21, 6],
  TOKYO: [0, 9],
  LONDON: [7, 16],
  NEW_YORK: [12, 21],
  OVERLAP: [12, 16], // London ∩ New York
} as const;

function inRange(hour: number, [start, end]: readonly [number, number]): boolean {
  if (start <= end) return hour >= start && hour < end;
  // wraps past midnight, e.g. Sydney 21 -> 6
  return hour >= start || hour < end;
}

/**
 * Classifies the UTC hour of `openedAt` into a market session.
 *
 * Precedence (checked in this order, first match wins):
 *   1. Weekend -> OFFHOURS, regardless of hour (see isWeekend's caveat).
 *   2. OVERLAP (12-16 UTC, London ∩ New York) — the highest-liquidity window,
 *      reported ahead of its two parent sessions.
 *   3. LONDON (7-16 UTC) — also covers the London/Tokyo overlap (7-9 UTC);
 *      London is reported there since it is the larger, more liquid session.
 *   4. NEW_YORK (12-21 UTC) — remaining New York hours not in OVERLAP.
 *   5. TOKYO (0-9 UTC) — remaining Tokyo hours not in London.
 *   6. SYDNEY (21-6 UTC).
 *   7. OFFHOURS as a fallback (unreachable in practice: the five ranges
 *      above already cover all 24 UTC hours on a weekday).
 *
 * Verified boundaries: 07:00 UTC -> LONDON, 11:59 -> LONDON, 12:00 ->
 * OVERLAP, 16:00 -> NEW_YORK (London has just closed), 20:59 -> NEW_YORK,
 * 21:00 -> SYDNEY (New York has just closed, Sydney opens).
 */
export function marketSession(openedAt: Date): MarketSession {
  if (isWeekend(openedAt)) return "OFFHOURS";
  const hour = openedAt.getUTCHours();
  if (inRange(hour, SESSION_RANGES_UTC.OVERLAP)) return "OVERLAP";
  if (inRange(hour, SESSION_RANGES_UTC.LONDON)) return "LONDON";
  if (inRange(hour, SESSION_RANGES_UTC.NEW_YORK)) return "NEW_YORK";
  if (inRange(hour, SESSION_RANGES_UTC.TOKYO)) return "TOKYO";
  if (inRange(hour, SESSION_RANGES_UTC.SYDNEY)) return "SYDNEY";
  return "OFFHOURS";
}

/**
 * True for Saturday/Sunday as measured by the UTC calendar day.
 *
 * Simplification: the real FX market closes Friday ~21:00 UTC and reopens
 * Sunday ~21:00-22:00 UTC (with Sydney), rather than following the UTC
 * calendar weekend exactly. We use the simpler calendar-weekend rule
 * throughout this module; it is off by a few hours right at the open/close
 * edges of the trading week, which is an accepted, documented limitation.
 */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export type Weekday = "SUNDAY" | "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY";

const WEEKDAYS: Weekday[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/**
 * Weekday of `date` as seen in `timeZone` (an IANA zone name, e.g.
 * "Asia/Ulaanbaatar"), using @date-fns/tz's `TZDate` to do the timezone
 * conversion correctly (including DST where applicable).
 */
export function tradingWeekday(date: Date, timeZone: string): Weekday {
  const zoned = new TZDate(date, timeZone);
  return WEEKDAYS[zoned.getDay()];
}
