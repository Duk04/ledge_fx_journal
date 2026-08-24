import { Decimal } from "decimal.js";
import type { Prisma } from "@prisma/client";

/**
 * Prisma ships its own Decimal implementation (decimal.js-light) which is NOT
 * the same class as the `decimal.js` Decimal the metrics module is built on.
 * They are structurally similar enough that mixing them silently *mostly*
 * works, which is exactly why this file exists: every crossing between the
 * database layer and the metrics layer goes through one of these two functions,
 * so there is no place where a stray instance of the wrong class can leak in.
 */

type PrismaDecimal = Prisma.Decimal;

/** DB value -> metrics Decimal. */
export function toDec(value: PrismaDecimal | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  return new Decimal(value.toString());
}

/** DB value -> metrics Decimal, with a default for non-nullable columns. */
export function toDecOr(value: PrismaDecimal | null | undefined, fallback: number | string = 0): Decimal {
  return toDec(value) ?? new Decimal(fallback);
}

/**
 * Metrics Decimal -> a value Prisma will accept for a Decimal column.
 * Strings are used rather than numbers so nothing is ever routed through a
 * float on the way into Postgres.
 */
export function fromDec(value: Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

/**
 * Metrics Decimal -> a plain value safe to hand a client component.
 * Server components cannot serialise a class instance across the RSC boundary,
 * so every number that reaches the UI passes through here. Strings (not
 * numbers) keep full precision; the display components parse them once.
 */
export function toPlain(value: Decimal | PrismaDecimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

/** Same, but for the handful of places that genuinely want a JS number (charts). */
export function toNum(value: Decimal | PrismaDecimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}
