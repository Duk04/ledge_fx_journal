/**
 * Broker symbol -> journal instrument.
 *
 * Brokers decorate symbols: "EURUSD.m", "EURUSDpro", "#EURUSD", "eurusd",
 * "XAUUSD-ECN", or rename them outright ("GOLD"). The importer resolves in
 * this order, first hit wins:
 *   1. the user's saved alias for that exact broker symbol (SymbolAlias),
 *   2. an exact match after upper-casing,
 *   3. a match after dropping every non-alphanumeric character,
 *   4. the longest known symbol the cleaned name STARTS with, if what is left
 *      over is a short suffix (≤ 4 chars: "M", "PRO", "ECN", "RAW", "I"…),
 *   5. a small table of common renames.
 * Anything else is UNMAPPED and the user picks the instrument in the preview;
 * that choice is saved as an alias for next time.
 *
 * The longest-prefix rule is what makes "EURJPYm" pick EURJPY. The length cap
 * only bounds how much decoration is stripped; it cannot tell a suffix from
 * a real symbol ("PRO" and "JPY" are both three letters), so step 4 is a
 * guess. That is acceptable only because every match is shown in the import
 * preview, where the user can override it.
 */

const RENAMES: Record<string, string> = {
  GOLD: "XAUUSD",
  SILVER: "XAGUSD",
  WTI: "USOIL",
  BRENT: "UKOIL",
  DJ30: "US30",
  DOW: "US30",
  USTEC: "NAS100",
  NDX: "NAS100",
  US100: "NAS100",
  US500: "SPX500",
  SP500: "SPX500",
  DE40: "GER40",
  DAX: "GER40",
  FTSE: "UK100",
  NIKKEI: "JP225",
};

export function resolveSymbol(
  raw: string,
  known: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string> = new Map(),
): string | null {
  const upper = raw.trim().toUpperCase();
  const alias = aliases.get(upper);
  if (alias && known.has(alias)) return alias;
  if (known.has(upper)) return upper;

  const cleaned = upper.replace(/[^A-Z0-9]/g, "");
  if (known.has(cleaned)) return cleaned;

  let best: string | null = null;
  for (const symbol of known) {
    if (cleaned.startsWith(symbol) && cleaned.length - symbol.length <= 4) {
      if (!best || symbol.length > best.length) best = symbol;
    }
  }
  if (best) return best;

  for (const [name, symbol] of Object.entries(RENAMES)) {
    if ((cleaned === name || (cleaned.startsWith(name) && cleaned.length - name.length <= 4)) && known.has(symbol)) {
      return symbol;
    }
  }
  return null;
}
