/**
 * Presentation-boundary formatters. This is the ONLY place in the metrics
 * module where Decimal values are converted to plain JS numbers/strings for
 * display — everywhere else stays in Decimal. All functions accept
 * `Decimal | number | null` (formatDuration takes `number | null`, since
 * holding-minutes is already a plain integer) and render "—" for null.
 */
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { Decimal } from "decimal.js";

type Numeric = Decimal | number | null | undefined;

function toNumber(value: Numeric): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Decimal ? value.toNumber() : value;
}

/** Money amount with a currency code, e.g. "$1,234.56" for USD, "-¥500" for JPY. "—" for null. */
export function formatMoney(value: Numeric, currency: string): string {
  const n = toNumber(value);
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    // Unknown/non-ISO currency code (shouldn't normally happen) — fall back to a plain number + code.
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** Pip count, fixed to `digits` decimal places (default 1). "—" for null. */
export function formatPips(value: Numeric, digits = 1): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return n.toFixed(digits);
}

/** R multiple, always signed, 2dp, e.g. "+1.85R", "-0.42R", "+0.00R". "—" for null. */
export function formatR(value: Numeric): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const sign = n < 0 ? "-" : "+";
  return `${sign}${Math.abs(n).toFixed(2)}R`;
}

/**
 * Percentage, formatted from a FRACTION (0-1), e.g. 0.625 -> "62.5%".
 * "—" for null.
 */
export function formatPercent(value: Numeric, digits = 1): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** Compact English duration from whole minutes, e.g. 200 -> "3h 20m", 45 -> "45m", 0 -> "0m". "—" for null. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const total = Math.round(Math.abs(minutes));
  const sign = minutes < 0 ? "-" : "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

/** Price fixed to `digits` decimal places (an instrument's InstrumentSpec.digits). "—" for null. */
export function formatPrice(value: Numeric, digits: number): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return n.toFixed(digits);
}

/**
 * A date-fns `pattern` rendered in the user's IANA `timezone`, e.g.
 * formatInZone(t.openedAt, user.timezone, "MMM d, HH:mm").
 *
 * Server components must use this instead of `toLocaleString()` /
 * `format(new Date(...))`: those render in the *server's* zone, so a Vercel
 * deploy (UTC) shows an Ulaanbaatar trader every time eight hours early, and
 * the day can flip — while the session badge next to it, computed in
 * lib/metrics/session.ts, is right. Never null-tolerant: a missing timestamp
 * is a caller bug, not a display state.
 */
export function formatInZone(at: Date | string, timezone: string, pattern: string): string {
  return format(new TZDate(new Date(at).getTime(), timezone), pattern);
}
