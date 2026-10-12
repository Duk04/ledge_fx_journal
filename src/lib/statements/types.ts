/**
 * The broker-statement importer's data shapes. Pure and dependency-free like
 * everything in this folder: the same parse runs for the preview (a dry run
 * of the import action) and for the real import, so what the user approves
 * is exactly what gets written. See docs/IMPORT.md.
 *
 * Every price, volume and money value is a DECIMAL STRING, never a number:
 * these feed straight into lib/metrics (decimal.js) and Prisma Decimal
 * columns, and a float round-trip is how 1.10000 becomes 1.0999999999.
 */

export type StatementSource = "MT4_HTML" | "MT5_HTML" | "CSV";

export type Direction = "LONG" | "SHORT";

/** One execution. Phase-2 positions carry exactly one ENTRY and, if closed,
 * one EXIT; the shape is ready for partial fills. */
export interface ParsedFill {
  kind: "ENTRY" | "EXIT";
  /** UTC epoch milliseconds. */
  at: number;
  price: string;
  volumeLots: string;
}

export interface ParsedPosition {
  /** The broker's id for the position: MT4 order ticket, MT5 position id. */
  ticket: string;
  /** As written in the statement, e.g. "eurusd", "EURUSD.m", "GOLD". */
  symbolRaw: string;
  direction: Direction;
  /** UTC epoch milliseconds. */
  openedAt: number;
  closedAt: number | null;
  entryPrice: string;
  exitPrice: string | null;
  volumeLots: string;
  stopLoss: string | null;
  takeProfit: string | null;
  /** Cost as the journal stores it: POSITIVE = paid. Brokers print it negative. */
  commission: string;
  /** Also journal convention: POSITIVE = paid (a credit is negative). The
   * broker prints the opposite sign; the parsers flip it. */
  swap: string;
  /** The broker's own gross profit in the account currency, when printed. */
  brokerProfit: string | null;
  fills: ParsedFill[];
}

export interface ParsedBalanceEvent {
  ticket: string;
  at: number;
  /** Signed: deposits positive, withdrawals negative. */
  amount: string;
  comment: string;
}

export interface ParseStatementResult {
  source: StatementSource;
  positions: ParsedPosition[];
  balanceEvents: ParsedBalanceEvent[];
  /** The account currency the statement says it is in, if it says. */
  currency: string | null;
  /** Rows recognised as trades but unusable (bad number, missing time…). */
  skipped: number;
  /** Things the user should read before importing. */
  warnings: string[];
}

/**
 * How the statement's wall-clock times map to UTC. MetaTrader writes every
 * time in the BROKER SERVER's clock with no zone marker (same problem as
 * candle exports — see src/lib/candles/parse.ts).
 *
 * - `ny-close`: the near-universal retail FX convention of a server clock at
 *   New York + 7h, so the daily candle closes at 17:00 New York. That is
 *   UTC+2 in the northern winter and UTC+3 in summer, switching on the US DST
 *   dates. Right for most brokers, and the only setting that is right on both
 *   sides of a DST change.
 * - `fixed`: a constant offset, minutes to ADD to UTC to get the wall clock.
 *   A fixed offset applied across a DST change shifts half of the trades by
 *   an hour, which silently moves some of them into a different session.
 */
export type BrokerTimezone = { mode: "ny-close" } | { mode: "fixed"; offsetMinutes: number };
