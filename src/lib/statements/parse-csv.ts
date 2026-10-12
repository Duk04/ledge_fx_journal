/**
 * Generic CSV, for brokers and platforms without a MetaTrader report
 * (cTrader exports, a spreadsheet you keep yourself). One row per position.
 * Columns are found by header name, case- and punctuation-insensitively, from
 * the aliases below; order does not matter and extra columns are ignored.
 *
 * Required: ticket, symbol, type, volume, open time, open price.
 * A row with close time + close price is closed; without, it is open.
 * Times: a bare "2024-03-05 13:30:00" is broker wall-clock (timezone setting
 * applies); an ISO value with Z/offset is used as is.
 * Commission and swap are read in the BROKER's sign convention (negative =
 * paid), same as the HTML reports, and flipped for the journal.
 */
import { brokerTimeToUtc } from "./broker-time";
import { cleanNumber, priceOrNull } from "./html-table";
import { negate } from "./decimal-strings";
import type { BrokerTimezone, ParseStatementResult, ParsedPosition } from "./types";

const ALIASES: Record<string, string[]> = {
  ticket: ["ticket", "position", "positionid", "id", "order", "deal"],
  symbol: ["symbol", "item", "instrument", "pair"],
  type: ["type", "direction", "side", "action"],
  volume: ["volume", "lots", "size", "quantity", "lotsize"],
  openTime: ["opentime", "openedat", "entrytime", "opendate", "timeopen"],
  openPrice: ["openprice", "entryprice", "entry", "priceopen"],
  closeTime: ["closetime", "closedat", "exittime", "closedate", "timeclose"],
  closePrice: ["closeprice", "exitprice", "exit", "priceclose"],
  stopLoss: ["sl", "stoploss", "stop"],
  takeProfit: ["tp", "takeprofit", "target"],
  commission: ["commission", "commissions", "fee", "fees"],
  swap: ["swap", "swaps", "rollover", "financing"],
  profit: ["profit", "grossprofit", "pnl", "pl"],
};

const REQUIRED = ["ticket", "symbol", "type", "volume", "openTime", "openPrice"] as const;

/** RFC-4180-ish: quoted fields, doubled quotes, comma or semicolon or tab. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseStatementCsv(text: string, tz: BrokerTimezone): ParseStatementResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const result: ParseStatementResult = {
    source: "CSV",
    positions: [],
    balanceEvents: [],
    currency: null,
    skipped: 0,
    warnings: [],
  };
  if (lines.length === 0) return result;

  const sep = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const header = splitLine(lines[0], sep).map(norm);
  const idx: Partial<Record<keyof typeof ALIASES, number>> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) idx[field] = i;
  }
  const missing = REQUIRED.filter((f) => idx[f] === undefined);
  if (missing.length) {
    result.warnings.push(
      `The CSV header is missing required column(s): ${missing.join(", ")}. ` +
        `Accepted names: ${REQUIRED.map((f) => ALIASES[f].join("/")).join("; ")}.`,
    );
    return result;
  }

  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    const get = (f: keyof typeof ALIASES) => (idx[f] === undefined ? undefined : cells[idx[f]!]);
    const type = (get("type") ?? "").toLowerCase();
    const direction = /^(buy|long|b)$/.test(type) ? "LONG" : /^(sell|short|s)$/.test(type) ? "SHORT" : null;
    const at = brokerTimeToUtc(get("openTime") ?? "", tz);
    const lots = cleanNumber(get("volume"));
    const entry = cleanNumber(get("openPrice"));
    const closeRaw = get("closeTime") ?? "";
    const closedAt = closeRaw ? brokerTimeToUtc(closeRaw, tz) : null;
    const exit = closeRaw ? cleanNumber(get("closePrice")) : null;
    const ticket = (get("ticket") ?? "").trim();

    if (
      !ticket ||
      !direction ||
      at === null ||
      lots === null ||
      entry === null ||
      (closeRaw && (closedAt === null || exit === null))
    ) {
      result.skipped++;
      continue;
    }

    const position: ParsedPosition = {
      ticket,
      symbolRaw: get("symbol") ?? "",
      direction,
      openedAt: at,
      closedAt,
      entryPrice: entry,
      exitPrice: exit,
      volumeLots: lots,
      stopLoss: priceOrNull(get("stopLoss")),
      takeProfit: priceOrNull(get("takeProfit")),
      commission: negate(cleanNumber(get("commission")) ?? "0"),
      swap: negate(cleanNumber(get("swap")) ?? "0"),
      brokerProfit: closedAt !== null ? cleanNumber(get("profit")) : null,
      fills: [
        { kind: "ENTRY", at, price: entry, volumeLots: lots },
        ...(closedAt !== null ? [{ kind: "EXIT" as const, at: closedAt, price: exit!, volumeLots: lots }] : []),
      ],
    };
    result.positions.push(position);
  }
  return result;
}
