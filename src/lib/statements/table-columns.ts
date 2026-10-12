import type { TableRow } from "./html-table";

/** Cells laid out on the grid their colspans imply, so a header cell and the
 * data cell under it share an index even when a row merges cells. */
export function expandRow(row: TableRow): string[] {
  const out: string[] = [];
  row.cells.forEach((cell, i) => {
    out.push(cell);
    for (let k = 1; k < row.spans[i]; k++) out.push("");
  });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Index of the nth (0-based) header cell named `name` (compared without case,
 * spaces or punctuation — "S / L" matches "s/l"), or -1. */
export function columnIndex(header: string[], name: string, nth = 0): number {
  const target = norm(name);
  let seen = 0;
  for (let i = 0; i < header.length; i++) {
    if (norm(header[i]) === target) {
      if (seen === nth) return i;
      seen++;
    }
  }
  return -1;
}

export function hasColumns(header: string[], names: string[]): boolean {
  return names.every((n) => columnIndex(header, n) >= 0);
}
