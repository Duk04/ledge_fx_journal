/**
 * MetaTrader 5 "Report" (History → Report → HTML). Saved as UTF-16LE with a
 * BOM; decodeStatement() in ./index.ts deals with that before this runs.
 *
 * Sections are announced by a single-cell title row: "Positions", "Orders",
 * "Deals", "Open Positions", "Working Orders", "Results". The importer reads:
 *
 * Positions — one row per CLOSED position, already aggregated by the
 *   terminal (volume-weighted prices when a position was scaled):
 *   Time | Position | Symbol | Type | Volume | Price | S / L | T / P |
 *   Time | Price | Commission | Swap | Profit
 *   The two "Time"/"Price" pairs are open and close, by position.
 *   The ticket is the POSITION id, not a deal or order number — it is the one
 *   id that identifies the whole trade and stays stable across re-exports.
 *
 * Open Positions — still-open positions, same leading columns; no exit.
 *
 * Deals — only for cash movements: rows of Type "balance"/"credit" are
 *   deposits/withdrawals (amount in Profit). Fill-level data from Deals is
 *   left for the executions work (docs/IMPORT.md, "Partial fills").
 */
import { brokerTimeToUtc } from "./broker-time";
import { cleanNumber, priceOrNull, readTableRows } from "./html-table";
import { columnIndex, expandRow, hasColumns } from "./table-columns";
import { negate } from "./decimal-strings";
import type { BrokerTimezone, ParseStatementResult, ParsedBalanceEvent, ParsedPosition } from "./types";

type Section = "positions" | "open" | "deals" | "other";

const TITLES: [RegExp, Section][] = [
  [/^open positions$/i, "open"],
  [/^positions$/i, "positions"],
  [/^deals$/i, "deals"],
  [/^(orders|working orders|results|summary)$/i, "other"],
];

export function parseMt5Html(html: string, tz: BrokerTimezone): ParseStatementResult {
  const rows = readTableRows(html);
  const positions: ParsedPosition[] = [];
  const balanceEvents: ParsedBalanceEvent[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  const currency = html.match(/\(([A-Z]{3}),\s*[^)]*\)/)?.[1] ?? null;

  let section: Section = "other";
  let header: string[] | null = null;

  for (const row of rows) {
    const cells = expandRow(row);
    const nonEmpty = row.cells.filter((c) => c !== "");

    if (nonEmpty.length === 1) {
      const title = TITLES.find(([re]) => re.test(nonEmpty[0]));
      if (title) {
        section = title[1];
        header = null;
        continue;
      }
    }
    if (section === "other") continue;

    if (section === "deals") {
      if (hasColumns(cells, ["Time", "Deal", "Symbol", "Type"])) {
        header = cells;
        continue;
      }
      if (!header) continue;
      const type = (cells[columnIndex(header, "Type")] ?? "").toLowerCase();
      if (type !== "balance" && type !== "credit") continue;
      const ticket = cells[columnIndex(header, "Deal")] ?? "";
      const at = brokerTimeToUtc(cells[columnIndex(header, "Time")] ?? "", tz);
      const amount = cleanNumber(cells[columnIndex(header, "Profit")]);
      if (!/^\d+$/.test(ticket) || at === null || amount === null) {
        skipped++;
        continue;
      }
      balanceEvents.push({ ticket, at, amount, comment: cells[columnIndex(header, "Comment")] ?? type });
      continue;
    }

    // positions / open
    if (hasColumns(cells, ["Time", "Position", "Symbol", "Type", "Volume", "Price"])) {
      header = cells;
      continue;
    }
    if (!header) continue;

    const col = (name: string, nth = 0) => cells[columnIndex(header!, name, nth)];
    const ticket = col("Position") ?? "";
    if (!/^\d+$/.test(ticket)) continue; // summary / spacer rows

    const type = (col("Type") ?? "").toLowerCase();
    if (type !== "buy" && type !== "sell") continue;

    const closed = section === "positions";
    const at = brokerTimeToUtc(col("Time") ?? "", tz);
    const lots = cleanNumber(col("Volume"));
    const entry = cleanNumber(col("Price"));
    const closedAt = closed ? brokerTimeToUtc(col("Time", 1) ?? "", tz) : null;
    const exit = closed ? cleanNumber(col("Price", 1)) : null;
    if (at === null || lots === null || entry === null || (closed && (closedAt === null || exit === null))) {
      skipped++;
      continue;
    }

    positions.push({
      ticket,
      symbolRaw: col("Symbol") ?? "",
      direction: type === "buy" ? "LONG" : "SHORT",
      openedAt: at,
      closedAt,
      entryPrice: entry,
      exitPrice: exit,
      volumeLots: lots,
      stopLoss: priceOrNull(col("S / L")),
      takeProfit: priceOrNull(col("T / P")),
      commission: negate(cleanNumber(col("Commission")) ?? "0"),
      swap: negate(cleanNumber(col("Swap")) ?? "0"),
      brokerProfit: closed ? cleanNumber(col("Profit")) : null,
      fills: [
        { kind: "ENTRY", at, price: entry, volumeLots: lots },
        ...(closed ? [{ kind: "EXIT" as const, at: closedAt!, price: exit!, volumeLots: lots }] : []),
      ],
    });
  }

  if (positions.length && !rows.some((r) => r.cells.some((c) => /^positions$/i.test(c)))) {
    warnings.push("No closed-positions section was found; only open positions were read.");
  }
  return { source: "MT5_HTML", positions, balanceEvents, currency, skipped, warnings };
}
