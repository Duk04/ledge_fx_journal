/**
 * MetaTrader 4 "Detailed Statement" (Account History → Save as Detailed
 * Report). One HTML table; sections announced by a title row ("Closed
 * Transactions:", "Open Trades:", "Working Orders:"), each followed by a
 * header row and data rows, ended by summary rows.
 *
 * Header: Ticket | Open Time | Type | Size | Item | Price | S / L | T / P |
 *         Close Time | Price | Commission | Taxes | Swap | Profit
 * "Open Trades" has the same columns; its second Price is the CURRENT market
 * price, not an exit, so open positions get no exit.
 *
 * Rows whose Type is "balance"/"credit" are cash movements. Pending order
 * types ("buy limit", "sell stop", …) in the closed section are cancelled
 * orders that never filled — not trades, and not counted as skipped.
 */
import { brokerTimeToUtc } from "./broker-time";
import { cleanNumber, priceOrNull, readTableRows } from "./html-table";
import { columnIndex, expandRow, hasColumns } from "./table-columns";
import type { BrokerTimezone, ParseStatementResult, ParsedBalanceEvent, ParsedPosition } from "./types";
import { addDecimalStrings, negate } from "./decimal-strings";

type Section = "closed" | "open" | "other";

export function parseMt4Html(html: string, tz: BrokerTimezone): ParseStatementResult {
  const rows = readTableRows(html);
  const positions: ParsedPosition[] = [];
  const balanceEvents: ParsedBalanceEvent[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let cancelled = 0;

  const currency = html.match(/Currency:\s*(?:<[^>]*>\s*)*([A-Z]{3})\b/)?.[1] ?? null;

  let section: Section = "other";
  let header: string[] | null = null;

  for (const row of rows) {
    const cells = expandRow(row);
    const first = cells[0] ?? "";

    if (/closed transactions/i.test(first)) {
      section = "closed";
      header = null;
      continue;
    }
    if (/open trades/i.test(first)) {
      section = "open";
      header = null;
      continue;
    }
    if (/working orders|summary|details/i.test(first) && row.cells.length <= 2) {
      section = "other";
      header = null;
      continue;
    }
    if (section === "other") continue;

    if (hasColumns(cells, ["Ticket", "Open Time", "Type", "Size", "Item"])) {
      header = cells;
      continue;
    }
    if (!header || !/^\d+$/.test(first)) continue;

    const col = (name: string, nth = 0) => cells[columnIndex(header!, name, nth)];
    const type = (col("Type") ?? "").toLowerCase();
    const ticket = first;
    const at = brokerTimeToUtc(col("Open Time") ?? "", tz);

    if (type === "balance" || type === "credit") {
      // Cash rows merge the middle columns; the amount is the last cell.
      const amount = cleanNumber(row.cells[row.cells.length - 1]);
      if (at === null || amount === null) {
        skipped++;
        continue;
      }
      balanceEvents.push({ ticket, at, amount, comment: row.cells[3] ?? type });
      continue;
    }
    if (type !== "buy" && type !== "sell") {
      if (section === "closed") cancelled++;
      continue;
    }

    const lots = cleanNumber(col("Size"));
    const entry = cleanNumber(col("Price"));
    const isClosed = section === "closed";
    const closedAt = isClosed ? brokerTimeToUtc(col("Close Time") ?? "", tz) : null;
    const exit = isClosed ? cleanNumber(col("Price", 1)) : null;
    if (at === null || lots === null || entry === null || (isClosed && (closedAt === null || exit === null))) {
      skipped++;
      continue;
    }

    const commission = negate(sum(cleanNumber(col("Commission")), cleanNumber(col("Taxes"))));
    positions.push({
      ticket,
      symbolRaw: col("Item") ?? "",
      direction: type === "buy" ? "LONG" : "SHORT",
      openedAt: at,
      closedAt,
      entryPrice: entry,
      exitPrice: exit,
      volumeLots: lots,
      stopLoss: priceOrNull(col("S / L")),
      takeProfit: priceOrNull(col("T / P")),
      commission,
      swap: negate(cleanNumber(col("Swap")) ?? "0"),
      brokerProfit: isClosed ? cleanNumber(col("Profit")) : null,
      fills: [
        { kind: "ENTRY", at, price: entry, volumeLots: lots },
        ...(isClosed ? [{ kind: "EXIT" as const, at: closedAt!, price: exit!, volumeLots: lots }] : []),
      ],
    });
  }

  if (cancelled) warnings.push(`${cancelled} cancelled pending order(s) were ignored — they never filled.`);
  return { source: "MT4_HTML", positions, balanceEvents, currency, skipped, warnings };
}

function sum(a: string | null, b: string | null): string {
  return addDecimalStrings(a ?? "0", b ?? "0");
}
