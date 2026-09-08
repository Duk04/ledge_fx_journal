import type { Decimal } from "decimal.js";

/**
 * Value accepted by every public metrics function before normalisation.
 * Internally everything is converted to `Decimal` via `d()` (see decimal.ts) —
 * see the module-level "money rule": no price/money/volume math happens in
 * native JS floating point.
 */
export type DecimalInput = Decimal | string | number;

/** Trade direction: LONG (bought) or SHORT (sold). */
export type Direction = "LONG" | "SHORT";

/** Broad asset category, used for grouping/reporting — never for calculation branching. */
export type AssetClass = "FX" | "METAL" | "INDEX" | "CRYPTO" | "ENERGY";

/** Final classification of a trade's result. */
export type Outcome = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";

/** Static contract facts for one tradable instrument, independent of any trade. */
export interface InstrumentSpec {
  /** Broker/exchange ticker, e.g. "EURUSD", "XAUUSD", "NAS100". */
  symbol: string;
  /** Size of one pip in price terms, e.g. 0.0001 for most FX pairs, 0.01 for JPY pairs / XAUUSD, 1 for many indices. */
  pipSize: DecimalInput;
  /** Units of the underlying per 1.0 lot, e.g. 100000 for FX, 100 for XAUUSD, 1 for most indices/CFDs. */
  contractSize: DecimalInput;
  /** Decimal places conventionally used to display this instrument's price. */
  digits: number;
  /** Currency the instrument is quoted in, e.g. "USD", "JPY". Pip value is computed in this currency before conversion. */
  quoteCurrency: string;
  /** Broad asset category, for grouping/reporting only. */
  assetClass: AssetClass;
}

/** One trade as recorded in the journal — the sole input to computeTrade(). */
export interface TradeInput {
  /** Instrument the trade was placed on. */
  instrument: InstrumentSpec;
  /** LONG (bought) or SHORT (sold). */
  direction: Direction;
  /** Price at which the position was opened. */
  entryPrice: DecimalInput;
  /** Price at which the position was closed. Undefined while the trade is still open. */
  exitPrice?: DecimalInput;
  /** Planned protective stop price, if any. */
  stopLoss?: DecimalInput;
  /** Planned target price, if any. */
  takeProfit?: DecimalInput;
  /** Position size in lots (1.0 = one standard lot per contractSize). */
  volumeLots: DecimalInput;
  /**
   * Broker commission. POSITIVE = a cost that reduces netPnl. A rebate can be
   * passed as a negative number and will correctly increase netPnl (see
   * computeNetPnl for the exact sign convention).
   */
  commission?: DecimalInput;
  /**
   * Broker swap/financing charge. POSITIVE = a cost that reduces netPnl. A
   * credit (e.g. positive carry) can be passed as a negative number.
   */
  swap?: DecimalInput;
  /** Multiplier converting 1 unit of quote currency into the account currency. Defaults to 1 (quote currency == account currency). */
  conversionRate?: DecimalInput;
  /** Timestamp the position was opened. */
  openedAt: Date;
  /** Timestamp the position was closed. Undefined while the trade is still open. */
  closedAt?: Date;
}

/** Fully derived numbers for one trade — the output of computeTrade(). */
export interface TradeResult {
  /** Signed price move expressed in pips (positive = favourable to the trade's direction). null while open. */
  pips: Decimal | null;
  /** Account-currency value of a one-pip move on 1.0 lot of this instrument (always positive). */
  pipValuePerLot: Decimal;
  /** pips * pipValuePerLot * volumeLots, before commission/swap. null while open. */
  grossPnl: Decimal | null;
  /** grossPnl - commission - swap (account currency). null while open. */
  netPnl: Decimal | null;
  /** Pure price risk implied by the stop loss, in account currency (excludes commission/swap — see computeRiskAmount doc). null if no stop loss is set. */
  riskAmount: Decimal | null;
  /** netPnl / riskAmount. null if there is no risk amount, or it is zero. */
  rMultiple: Decimal | null;
  /** |takeProfit - entry| / |stopLoss - entry| — the reward:risk ratio planned before entry. null if either leg is missing or the geometry is invalid (see validateTradeGeometry). */
  plannedRR: Decimal | null;
  /** Whole minutes between openedAt and closedAt. null while open. */
  holdingMinutes: number | null;
  /** WIN / LOSS / BREAKEVEN / OPEN classification (see classifyOutcome). */
  outcome: Outcome;
}

/** Stable machine-readable codes for problems found by validateTradeGeometry. */
export type TradeGeometryProblemCode =
  "SL_WRONG_SIDE" | "TP_WRONG_SIDE" | "ZERO_OR_NEGATIVE_VOLUME" | "CLOSED_BEFORE_OPENED";

/** One problem found by validateTradeGeometry. */
export interface TradeGeometryProblem {
  code: TradeGeometryProblemCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Aggregate types (src/lib/metrics/aggregate.ts)
// ---------------------------------------------------------------------------

/** Minimal shape aggregate.ts needs from a persisted trade plus its computed TradeResult. */
export interface TradeRow {
  /** Net P&L in account currency; null while the trade is open. */
  netPnl: Decimal | null;
  /** R multiple; null if there was no stop loss (see computeRiskAmount) or the trade is open. */
  rMultiple: Decimal | null;
  /** WIN / LOSS / BREAKEVEN / OPEN. */
  outcome: Outcome;
  /** When the position was opened. */
  openedAt: Date;
  /** When the position was closed; null while open. */
  closedAt: Date | null;
  /** Whole minutes held; null while open. Optional because some callers may not have computed it. */
  holdingMinutes?: number | null;
}

/** Rolled-up performance statistics over a set of trades. Produced by summarize(). */
export interface Summary {
  /** Total rows passed in, open or closed. */
  tradeCount: number;
  /** Rows with outcome !== 'OPEN'. */
  closedCount: number;
  /** Rows with outcome === 'OPEN'. */
  openCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** wins / (wins + losses). Breakevens are excluded from BOTH the numerator and the denominator. null if wins + losses === 0. */
  winRate: number | null;
  /** Sum of netPnl over WIN rows (always >= 0). */
  grossProfit: Decimal;
  /** Sum of |netPnl| over LOSS rows (always >= 0, i.e. reported as a positive magnitude). */
  grossLoss: Decimal;
  /** Sum of netPnl over all closed rows (wins + losses + breakevens). */
  netPnl: Decimal;
  /** grossProfit / grossLoss. null (never Infinity) when grossLoss is zero. */
  profitFactor: Decimal | null;
  /** Mean netPnl over WIN rows. null if there are no wins. */
  averageWin: Decimal | null;
  /** Mean |netPnl| over LOSS rows (positive magnitude). null if there are no losses. */
  averageLoss: Decimal | null;
  /** Mean rMultiple over rows with a non-null rMultiple (regardless of outcome). null if none. */
  averageRMultiple: Decimal | null;
  /** (winRate * averageWin) - ((1 - winRate) * averageLoss). null if winRate/averageWin/averageLoss unavailable. */
  expectancyMoney: Decimal | null;
  /** Same construction as expectancyMoney but built from average WIN/LOSS R multiples. null if unavailable. */
  expectancyR: Decimal | null;
  /** Largest single netPnl among WIN rows. null if there are no wins. */
  largestWin: Decimal | null;
  /** Largest single |netPnl| among LOSS rows (positive magnitude). null if there are no losses. */
  largestLoss: Decimal | null;
  /** averageWin / averageLoss. null if either is unavailable or averageLoss is zero. */
  payoffRatio: Decimal | null;
  /** Sample standard deviation (n-1) of rMultiple over rows with a non-null rMultiple. null if fewer than 2 such rows. */
  standardDeviationR: Decimal | null;
  /** "System Quality Number": averageRMultiple / standardDeviationR * sqrt(n). Only meaningful with n >= 30 trades — see docs/METRICS.md. null if unavailable. */
  systemQuality: Decimal | null;
  /** Longest run of consecutive wins (breakevens are skipped, not counted as breaking a streak — see aggregate.ts doc). */
  longestWinStreak: number;
  /** Longest run of consecutive losses (same breakeven handling as above). */
  longestLossStreak: number;
  /** Signed length of the run in progress as of the most recent (non-breakeven) closed trade: positive = current win streak, negative = current loss streak, 0 = no closed win/loss trades yet. */
  currentStreak: number;
  /** Mean holdingMinutes over rows that provide it. null if none do. */
  averageHoldingMinutes: number | null;
  /** 1 / (1 + payoffRatio): the win rate this system would need just to break even, given its payoff ratio. null if payoffRatio is unavailable. */
  breakevenWinRate: number | null;
}

/** Kind of an external account balance change unrelated to a trade. */
export type BalanceEventKind = "DEPOSIT" | "WITHDRAWAL" | "ADJUSTMENT";

/** External balance change (deposit/withdrawal/manual adjustment) to merge into the equity curve. */
export interface BalanceEvent {
  at: Date;
  /** Signed amount: positive increases balance, negative decreases it (e.g. a withdrawal is negative). */
  amount: DecimalInput;
  kind: BalanceEventKind;
}

/** Kind of one equity curve point. */
export type EquityPointKind = "TRADE" | BalanceEventKind;

/** One point on the equity curve, produced by equityCurve(). */
export interface EquityPoint {
  at: Date;
  /** Running account balance after this point is applied. */
  balance: Decimal;
  /** Signed change this point contributed (netPnl for a trade, amount for a balance event). */
  change: Decimal;
  kind: EquityPointKind;
}

/** One point on the drawdown series derived from an equity curve, produced by drawdownSeries(). */
export interface DrawdownPoint {
  at: Date;
  balance: Decimal;
  /** High-water mark as of this point (see aggregate.ts doc for how deposits are excluded from setting a new peak). */
  peak: Decimal;
  /** peak - balance, floored at 0. */
  drawdown: Decimal;
  /** drawdown as a percentage of peak (0-100 scale), floored at 0. */
  drawdownPct: Decimal;
}

/** The single worst drawdown episode found in a drawdown series, produced by maxDrawdown(). */
export interface MaxDrawdown {
  amount: Decimal;
  /** Percentage of peak (0-100 scale). */
  pct: Decimal;
  /** When the high-water mark that this drawdown fell from was set. */
  peakAt: Date;
  /** When the drawdown reached its worst (lowest balance relative to peak) point. */
  troughAt: Date;
  /** First time balance returned to/above the peak value after the trough. null if not yet recovered. */
  recoveredAt: Date | null;
  /** Days from peakAt to recoveredAt. null while unrecovered. */
  lengthDays: number | null;
}

/** One bucket of the R-multiple histogram produced by rDistribution(). */
export interface RBucket {
  /** Inclusive lower bound of this bucket. null for the special "no stop loss / no R" bucket. */
  from: number | null;
  /** Exclusive upper bound of this bucket (inclusive for the final bucket). null for the "no R" bucket. */
  to: number | null;
  count: number;
  netPnl: Decimal;
}

/** Net P&L total for one calendar day in a requested timezone, produced by dailyPnl(). */
export interface DailyPnl {
  /** "YYYY-MM-DD" in the requested timezone. */
  date: string;
  netPnl: Decimal;
  tradeCount: number;
}
