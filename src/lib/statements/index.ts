/**
 * Broker statement import — the pure half. Detects the format, decodes the
 * bytes, and returns positions + cash movements. Everything that touches the
 * database (symbol aliases, duplicate tickets, writing rows) is in
 * src/lib/actions/statements.ts. docs/IMPORT.md is the overview.
 */
import { parseMt4Html } from "./parse-mt4";
import { parseMt5Html } from "./parse-mt5";
import { parseStatementCsv } from "./parse-csv";
import type { BrokerTimezone, ParseStatementResult } from "./types";

export * from "./types";
export { resolveSymbol } from "./symbols";
export { brokerTimeToUtc } from "./broker-time";
export { reconcile, type Reconciliation } from "./reconcile";

/**
 * Bytes -> text. MT5 writes its HTML report as UTF-16LE with a BOM (FF FE);
 * read as UTF-8 that is every other byte NUL and no table is ever found,
 * which looks to the user like "the importer can't read my file". MT4 and
 * CSV exports are UTF-8 or Windows-1252; for the ASCII those consist of, UTF-8
 * decoding is correct either way.
 */
export function decodeStatement(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  // UTF-16LE without a BOM: ASCII text with a NUL after every byte.
  if (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0 && bytes[0] !== 0) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export function detectFormat(text: string): ParseStatementResult["source"] | null {
  const head = text.slice(0, 200_000);
  if (/<html|<table/i.test(head)) {
    if (/Trade History Report|>\s*Positions\s*<|>\s*Position\s*</i.test(head)) return "MT5_HTML";
    if (/Closed Transactions|>\s*Ticket\s*<.*?>\s*Item\s*</is.test(head)) return "MT4_HTML";
    return null;
  }
  return "CSV";
}

export function parseStatement(text: string, tz: BrokerTimezone): ParseStatementResult {
  const format = detectFormat(text);
  const empty = (warning: string): ParseStatementResult => ({
    source: format ?? "CSV",
    positions: [],
    balanceEvents: [],
    currency: null,
    skipped: 0,
    warnings: [warning],
  });

  if (format === null) {
    return empty(
      "This HTML doesn't look like a MetaTrader statement. Export it from MT4 (Account History → Save as Detailed Report) or MT5 (History → Report → HTML), in English.",
    );
  }
  const result =
    format === "MT4_HTML"
      ? parseMt4Html(text, tz)
      : format === "MT5_HTML"
        ? parseMt5Html(text, tz)
        : parseStatementCsv(text, tz);

  if (result.positions.length === 0 && result.balanceEvents.length === 0 && result.warnings.length === 0) {
    result.warnings.push(
      format === "CSV"
        ? "No trades were found in this CSV."
        : "No trades were found. Only English-language MetaTrader reports are supported — a report from a terminal in another language has differently-named columns.",
    );
  }
  return result;
}
export { planImport, tradeInputFor, type ImportPlan, type PlannedPosition, type PlannedStatus } from "./plan";
