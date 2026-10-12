import { Decimal } from "decimal.js";

/** Sign flip on a decimal string, without a float round-trip. "-0" -> "0". */
export function negate(value: string): string {
  const d = new Decimal(value).negated();
  return d.isZero() ? "0" : d.toString();
}

export function addDecimalStrings(a: string, b: string): string {
  return new Decimal(a).plus(b).toString();
}
