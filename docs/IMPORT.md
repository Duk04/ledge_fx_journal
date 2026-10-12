# Importing broker statements

Owns: `src/lib/statements/` (pure parsing and planning),
`src/lib/actions/statements.ts` (the one write path),
`src/components/trades/statement-import.tsx`, `/trades/import`.

Trades → **Import statement**. Pick a file, say how its times map to UTC,
look at the preview, import. Nothing is written until you confirm, and every
import can be undone as a unit.

## Formats

| Format | How to export it | Read from |
|---|---|---|
| MT4 Detailed Statement | Terminal → Account History → right-click → *Save as Detailed Report* | "Closed Transactions", "Open Trades", balance rows |
| MT5 Report | Toolbox → History → right-click → *Report* → HTML | "Positions", "Open Positions", balance rows in "Deals" |
| CSV | Anything with one row per position | Columns found by header name (`parse-csv.ts` lists the accepted names) |

English-language reports only: the parsers find columns by their header text.
A report from a terminal in another language has different headers, and the
importer says so rather than returning an empty preview.

MT5 writes its HTML as **UTF-16LE**. Read as UTF-8 that is a NUL after every
character and no table is ever found — `decodeStatement()` checks the BOM (and
the NUL pattern when there is none) first.

The ticket is the MT4 order ticket / the MT5 **position** id — the id that
names the whole trade and stays stable between exports. It is stored as
`Trade.externalTicket`, unique per account, and is how re-imports are
recognised.

## Time

MetaTrader prints every time in the broker server's clock with no zone
marker. Two readings are offered:

- **New York close** (default): server time = New York + 7h, so the daily bar
  closes at 17:00 New York. That is UTC+2 in winter and UTC+3 in summer,
  switching on the **US** DST dates. It is what the large majority of retail
  FX brokers run, and the only setting that is right on both sides of a DST
  change.
- **Fixed offset**: for the rest. A fixed offset across a DST change shifts
  half the trades by an hour, which moves some into a different session —
  silently, which is why it is not the default.

Times that carry their own offset (`2026-03-04T13:30:00Z` in a CSV) are used
as they are. The reading used is stored on the `TradeImport` row.

## Costs and signs

The journal's convention (`docs/METRICS.md`) is commission and swap as
**positive = paid**. Brokers print both as negative when paid. The parsers
flip them. MT4's *Taxes* column is folded into commission.

## Conversion rates, and the broker's profit

The broker's *Profit* column — gross, in the account currency — is kept as
`Trade.brokerProfit` and used two ways (`reconcile.ts`):

- **Crosses** (EURJPY in a USD account): `lib/conversion.ts` cannot derive the
  JPY→USD rate from the trade itself and would assume 1 and flag the trade.
  The importer instead stores the rate the broker's profit implies,
  `profit / (direction · Δprice · contractSize · lots)`, so the trade is exact
  with nothing to fix by hand. The preview marks these "rate from broker".
- **Everything else**: the rate is already known (identity or 1/price); the
  importer only checks our gross against the broker's. Outside ½% (min 2
  cents) the row is marked ≠. It is deliberately *not* fixed with an implied
  rate: a mismatch there nearly always means the broker's contract size for
  that instrument differs from the journal's (an index CFD), and that needs to
  be visible, not absorbed.

## Symbols

`EURUSD.m`, `#EURUSD`, `eurusd`, `XAUUSD-ECN`, `GOLD`… Resolution order is in
`symbols.ts`: the user's saved alias, exact, alphanumerics only, longest known
prefix with a short suffix, then a small rename table. Anything left is asked
about in the preview; the answer is saved as a `SymbolAlias` (per user) and
used on every later import. The suffix rule is a guess — it cannot tell
`EURUSDPRO` from a hypothetical `EURUSDJPY` — which is acceptable only because
every match is visible in the preview.

## Re-importing

Import last week's statement, then this week's — overlap is expected:

- a ticket already in the account is **skipped**;
- a ticket imported while **open** that the new statement shows **closed** is
  **closed in place**: exit, close time, costs, broker profit and the derived
  columns are updated; notes, tags, emotion and plan fields are never
  touched;
- deposits and withdrawals dedupe on their own ticket
  (`BalanceEvent.externalTicket`).

## Undo

Each import is a `TradeImport` row; the trades and cash movements it created
point to it. **Undo** deletes exactly those, then the row. A position the
import only *closed* existed before it and is left alone.

## Partial fills

Not yet. MT5's Positions table is already aggregated (volume-weighted prices)
and is what is read; the parsers emit a `fills` array with one entry and one
exit so the executions work can fill it in from the Deals table later without
changing the format code.
