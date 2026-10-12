/**
 * Minimal, tolerant HTML table reader for MetaTrader reports. Not a general
 * HTML parser: MT statements are machine-written, flat tables with no nested
 * tables inside cells, which is exactly what a regex pass can read reliably
 * — and it keeps this module dependency-free so the same code runs in the
 * browser and on the server.
 */

export interface TableRow {
  cells: string[];
  /** colspan of each cell; 1 when absent. */
  spans: number[];
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return whole;
  });
}

function cellText(inner: string): string {
  return decodeEntities(inner.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** Every <tr> in document order, with its cells' plain text. */
export function readTableRows(html: string): TableRow[] {
  const rows: TableRow[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi;
  for (const tr of html.matchAll(trRe)) {
    const cells: string[] = [];
    const spans: number[] = [];
    const cellRe = /<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi;
    for (const c of tr[1].matchAll(cellRe)) {
      const span = c[2].match(/colspan\s*=\s*["']?(\d+)/i);
      cells.push(cellText(c[3].replace(/<\/t[dh]>\s*$/i, "")));
      spans.push(span ? Number(span[1]) : 1);
    }
    if (cells.length) rows.push({ cells, spans });
  }
  return rows;
}

/** MetaTrader writes thousands with spaces ("10 000.00") and sometimes a
 * non-breaking space; numbers are otherwise plain. Returns a canonical
 * decimal string, or null for blank/garbage. */
export function cleanNumber(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const s = raw.replace(/[\s ]/g, "");
  if (s === "" || !/^[+-]?\d+(?:\.\d+)?$/.test(s)) return null;
  return s.startsWith("+") ? s.slice(1) : s;
}

/** A price of exactly zero means "not set" in MT reports (S/L, T/P). */
export function priceOrNull(raw: string | undefined): string | null {
  const n = cleanNumber(raw);
  return n === null || Number(n) === 0 ? null : n;
}
