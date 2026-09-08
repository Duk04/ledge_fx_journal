import "server-only";
import { db } from "@/lib/db";

/**
 * Reads of the shared `Instrument` table.
 *
 * `Instrument` has no `userId` — one row per symbol, shared by every account
 * on the instance (see the scoping-rule exceptions in `src/lib/session.ts`).
 * Reads are therefore unscoped by design; WRITES are owner-only and live in
 * `src/app/(app)/settings/actions.ts`.
 *
 * This module exists so pages stop reaching past the query layer into Prisma.
 * The `isActive` list was duplicated in three places — two backtest pages and
 * a server action — which is the usual outcome of a query that has nowhere to
 * live.
 */

export interface InstrumentOption {
  symbol: string;
  /** Falls back to the symbol: every consumer renders this as a label, and
   * `displayName` is nullable in the schema. Coercing here keeps the null out
   * of the components. */
  displayName: string;
}

/** Active symbols, alphabetically — for pickers. */
export async function listActiveInstruments(): Promise<InstrumentOption[]> {
  const rows = await db.instrument.findMany({
    where: { isActive: true },
    orderBy: { symbol: "asc" },
    select: { symbol: true, displayName: true },
  });
  return rows.map((r) => ({ symbol: r.symbol, displayName: r.displayName ?? r.symbol }));
}

/** Active symbols only, for validating a submitted symbol against the table. */
export async function listActiveSymbols(): Promise<string[]> {
  const rows = await db.instrument.findMany({
    where: { isActive: true },
    orderBy: { symbol: "asc" },
    select: { symbol: true },
  });
  return rows.map((r) => r.symbol);
}

/** One instrument's full row, or null. Used where the contract fields matter. */
export async function getInstrument(symbol: string) {
  return db.instrument.findUnique({ where: { symbol } });
}
