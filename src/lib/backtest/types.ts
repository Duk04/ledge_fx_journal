/**
 * The contract every part of the backtester is written against.
 *
 * Plain numbers, not Decimal, on purpose. A backtest walks millions of bars and
 * Decimal arithmetic makes that unbearably slow; the journal's Decimal-based
 * metrics layer takes over at the boundary, once a simulated trade is finished
 * and there are dozens of values rather than millions. `toJournalTrade()` in
 * runner.ts is that boundary.
 *
 * Prices are absolute. "Points" are the instrument's smallest quoted increment
 * (10^-digits), NOT pips — a 5-digit EURUSD pip is 10 points. Brokers quote
 * spread and slippage in points, so the fill model speaks points and converts.
 */

export type Side = "LONG" | "SHORT";

/** One OHLC bar. `ts` is the bar's OPEN time as a UTC epoch in milliseconds. */
export interface Bar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /** Spread in points at bar close, when the data source recorded it. */
  spread?: number;
}

/** Everything about an instrument the simulator needs. */
export interface SimInstrument {
  symbol: string;
  digits: number;
  pipSize: number;
  contractSize: number;
  quoteCurrency: string;
  /** Smallest quoted increment: 10^-digits. */
  pointSize: number;
}

/**
 * The assumptions that decide whether a backtest is informative or flattering.
 * Every one of these defaults to the pessimistic choice.
 */
export interface FillModel {
  /** Charged on entry and on exit. Overridden by a bar's own spread if present. */
  spreadPoints: number;
  /** Per lot, per side, in account currency. */
  commissionPerLot: number;
  /** Adverse price movement applied to every fill, in points. */
  slippagePoints: number;
  /**
   * When one bar's range contains both the stop and the target, we cannot know
   * which came first without finer data. True assumes the stop — the honest
   * default, because assuming the target inflates every result that matters.
   */
  pessimisticFills: boolean;
  /** Multiplier from quote currency to account currency. */
  conversionRate: number;
}

export type ExitReason = "STOP_LOSS" | "TAKE_PROFIT" | "SIGNAL" | "END_OF_DATA";

/** A request to open a position, as a strategy or a replay click expresses it. */
export interface OrderRequest {
  side: Side;
  lots: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Free-text label carried through to the journal entry. */
  reason?: string;
}

/** An open position inside the simulation. */
export interface SimPosition {
  side: Side;
  lots: number;
  entryTs: number;
  /** The price actually paid, after spread and slippage. */
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  reason?: string;
}

/** A finished simulated trade, before it becomes a journal Trade row. */
export interface SimTrade {
  side: Side;
  lots: number;
  entryTs: number;
  entryPrice: number;
  exitTs: number;
  exitPrice: number;
  exitReason: ExitReason;
  stopLoss?: number;
  takeProfit?: number;
  /** Signed, in account currency, after costs. */
  netPnl: number;
  grossPnl: number;
  commission: number;
  pips: number;
  /** null when there was no stop, exactly as in the live journal. */
  rMultiple: number | null;
  riskAmount: number | null;
  holdingMinutes: number;
  reason?: string;
}

/** What a strategy sees on each bar. */
export interface StrategyContext {
  /** Bars up to and including the current one. Never contains the future. */
  readonly bars: readonly Bar[];
  /** Index of the current bar within `bars`. */
  readonly i: number;
  readonly bar: Bar;
  readonly position: SimPosition | null;
  readonly equity: number;
  readonly balance: number;
  readonly instrument: SimInstrument;
  /** Parameter values for this run. */
  readonly params: Record<string, number | string | boolean>;

  /** Open a position at the NEXT bar's open. Ignored if one is already open. */
  buy(order: Omit<OrderRequest, "side">): void;
  sell(order: Omit<OrderRequest, "side">): void;
  /** Close the open position at the next bar's open. */
  close(reason?: string): void;
  /** Move the stop or target on the open position, effective immediately. */
  modify(update: { stopLoss?: number; takeProfit?: number }): void;
  /** Diagnostic message attached to the run log, capped per run. */
  log(message: string): void;
}

/** The shape a user's strategy code must export. */
export interface StrategyModule {
  /** Called once before the first bar. */
  init?: (ctx: Pick<StrategyContext, "instrument" | "params" | "log">) => void;
  /** Called on every bar, oldest first. */
  onBar: (ctx: StrategyContext) => void;
}

export interface BacktestConfig {
  instrument: SimInstrument;
  fill: FillModel;
  initialBalance: number;
  params?: Record<string, number | string | boolean>;
  /** Hard cap on strategy runtime, in milliseconds. */
  timeoutMs?: number;
}

export interface BacktestResult {
  trades: SimTrade[];
  /** Balance after each closed trade, starting with the initial balance. */
  equity: { ts: number; balance: number }[];
  logs: string[];
  barsProcessed: number;
  /** Set when the run stopped early. */
  error?: string;
}
