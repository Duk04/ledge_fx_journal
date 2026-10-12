/**
 * Executions (fills) -> the trade-level aggregate columns.
 *
 * A trade can be built from several fills: scaling in (more ENTRY fills),
 * partial closes (several EXIT fills). The Execution rows are the source of
 * truth; the Trade row keeps entry/exit/volume/opened/closed as AGGREGATES of
 * them, written only through trade-service, so that every list, filter, sort,
 * export and report keeps reading one row per trade and needs no change.
 *
 * The aggregate:
 *   entryPrice = volume-weighted average of ENTRY fills
 *   exitPrice  = volume-weighted average of EXIT fills (null until fully closed)
 *   volumeLots = total ENTRY volume
 *   openedAt   = first ENTRY;  closedAt = last EXIT, once fully closed
 *
 * Why this is exact, not an approximation: for a FULLY closed position the
 * realised P&L is total exit proceeds minus total entry cost, whatever order
 * the fills came in, which is direction · (VWAP exit − VWAP entry) · total
 * lots — the same formula lib/metrics/trade.ts already applies to a single
 * entry and exit. So the existing formulas stay untouched, and a trade with
 * one entry and one exit produces bit-for-bit the numbers it always did.
 *
 * A PARTIALLY closed position stays OPEN and has no realised P&L in the
 * journal until it is fully closed. Average-cost realised P&L on the closed
 * part is well defined, but nothing downstream (stats, equity, the risk guard)
 * has a notion of "part of a trade closed"; reporting it would need its own
 * column and its own rules. docs/TRADES.md, "Executions".
 */
import { Decimal } from "decimal.js";

export interface Fill {
  kind: "ENTRY" | "EXIT";
  executedAt: Date;
  price: Decimal.Value;
  volumeLots: Decimal.Value;
}

export interface FillAggregate {
  entryPrice: Decimal;
  exitPrice: Decimal | null;
  volumeLots: Decimal;
  /** Total EXIT volume so far. */
  exitedLots: Decimal;
  openedAt: Date;
  closedAt: Date | null;
  status: "OPEN" | "CLOSED";
}

export type FillProblem =
  | { code: "NO_ENTRY"; message: string }
  | { code: "EXIT_BEFORE_ENTRY"; message: string }
  | { code: "OVER_CLOSED"; message: string }
  | { code: "NON_POSITIVE"; message: string };

function chronological(fills: readonly Fill[]): Fill[] {
  // Stable: two fills at the same instant keep their given order, and an
  // ENTRY sorts before an EXIT at the same instant (you cannot close what is
  // not yet open).
  return fills
    .map((f, i) => ({ f, i }))
    .sort(
      (a, b) =>
        a.f.executedAt.getTime() - b.f.executedAt.getTime() ||
        (a.f.kind === b.f.kind ? 0 : a.f.kind === "ENTRY" ? -1 : 1) ||
        a.i - b.i,
    )
    .map(({ f }) => f);
}

/** Every reason a set of fills cannot describe a position. Empty = valid. */
export function validateFills(fills: readonly Fill[]): FillProblem[] {
  const problems: FillProblem[] = [];
  if (!fills.some((f) => f.kind === "ENTRY")) {
    problems.push({ code: "NO_ENTRY", message: "A trade needs at least one entry fill." });
    return problems;
  }
  if (fills.some((f) => new Decimal(f.price).lte(0) || new Decimal(f.volumeLots).lte(0))) {
    problems.push({ code: "NON_POSITIVE", message: "Every fill needs a positive price and volume." });
  }
  let open = new Decimal(0);
  for (const f of chronological(fills)) {
    if (f.kind === "ENTRY") {
      open = open.plus(f.volumeLots);
      continue;
    }
    if (open.isZero()) {
      problems.push({ code: "EXIT_BEFORE_ENTRY", message: "An exit is dated before any entry." });
      break;
    }
    open = open.minus(f.volumeLots);
    if (open.lt(0)) {
      problems.push({ code: "OVER_CLOSED", message: "Exits add up to more than was entered." });
      break;
    }
  }
  return problems;
}

/** Throws on invalid fills — call validateFills first where the input is
 * user-supplied; this is for paths that have already validated. */
export function aggregateFills(fills: readonly Fill[]): FillAggregate {
  const problems = validateFills(fills);
  if (problems.length) throw new Error(problems[0].message);

  const sorted = chronological(fills);
  const entries = sorted.filter((f) => f.kind === "ENTRY");
  const exits = sorted.filter((f) => f.kind === "EXIT");

  const sum = (xs: Fill[], fn: (f: Fill) => Decimal) => xs.reduce((acc, f) => acc.plus(fn(f)), new Decimal(0));
  const entryLots = sum(entries, (f) => new Decimal(f.volumeLots));
  const exitLots = sum(exits, (f) => new Decimal(f.volumeLots));
  const vwap = (xs: Fill[], lots: Decimal) => sum(xs, (f) => new Decimal(f.price).times(f.volumeLots)).div(lots);

  const closed = exits.length > 0 && exitLots.eq(entryLots);
  return {
    entryPrice: vwap(entries, entryLots),
    exitPrice: closed ? vwap(exits, exitLots) : null,
    volumeLots: entryLots,
    exitedLots: exitLots,
    openedAt: entries[0].executedAt,
    closedAt: closed ? exits[exits.length - 1].executedAt : null,
    status: closed ? "CLOSED" : "OPEN",
  };
}

/** The fills a trade entered as a single entry (and exit) stands for — what
 * every one-shot write path records, and what the migration backfilled. */
export function simpleFills(trade: {
  openedAt: Date;
  entryPrice: Decimal.Value;
  volumeLots: Decimal.Value;
  closedAt?: Date | null;
  exitPrice?: Decimal.Value | null;
}): Fill[] {
  const fills: Fill[] = [
    { kind: "ENTRY", executedAt: trade.openedAt, price: trade.entryPrice, volumeLots: trade.volumeLots },
  ];
  if (trade.closedAt && trade.exitPrice !== null && trade.exitPrice !== undefined) {
    fills.push({ kind: "EXIT", executedAt: trade.closedAt, price: trade.exitPrice, volumeLots: trade.volumeLots });
  }
  return fills;
}
