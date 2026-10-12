import { TZDate } from "@date-fns/tz";
import type { BrokerTimezone } from "./types";

/** "2024.03.05 13:30:00", "2024.03.05 13:30", "2024-03-05 13:30:00",
 * "2024/03/05 13:30". Returns null for anything else. */
export function parseWallClock(raw: string): [number, number, number, number, number, number] | null {
  const m = raw.trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return [y, mo, d, h, mi, s];
}

/**
 * A broker wall-clock reading -> UTC epoch ms, or null if unparseable.
 *
 * An ISO string with its own `Z`/offset is already absolute and is used as is
 * (the generic CSV path can carry those); applying the broker offset to it
 * would double-shift it.
 */
export function brokerTimeToUtc(raw: string, tz: BrokerTimezone): number | null {
  const trimmed = raw.trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed) && /^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? null : ms;
  }

  const f = parseWallClock(trimmed);
  if (!f) return null;
  const [y, mo, d, h, mi, s] = f;

  if (tz.mode === "fixed") {
    return Date.UTC(y, mo - 1, d, h, mi, s) - tz.offsetMinutes * 60_000;
  }

  // ny-close: the server clock is New York wall time + 7h. Take 7h off the
  // reading (via a UTC-field Date so the day/month rolls correctly), then
  // interpret that as New York local time — which is where the US DST rule,
  // and therefore the UTC+2/UTC+3 switch, comes from.
  const ny = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 7 * 3_600_000);
  return TZDate.tz(
    "America/New_York",
    ny.getUTCFullYear(),
    ny.getUTCMonth(),
    ny.getUTCDate(),
    ny.getUTCHours(),
    ny.getUTCMinutes(),
    ny.getUTCSeconds(),
  ).getTime();
}
