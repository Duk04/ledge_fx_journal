/**
 * The event loop that turns a strategy and a bar series into a
 * `BacktestResult`. See docs/BACKTEST-ENGINE.md for the full write-up of the
 * no-lookahead guarantee this file enforces.
 */
import { marketSession } from "../metrics";
import { closeAtPrice, entryPrice, exitAtMarket, exitOnBar, pipsBetween } from "./fill";
import type {
  Bar,
  BacktestConfig,
  BacktestResult,
  OrderRequest,
  Side,
  SimInstrument,
  SimPosition,
  SimTrade,
  StrategyContext,
  StrategyModule,
} from "./types";

/** Default hard timeout for a single run, per BacktestConfig.timeoutMs. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Hard cap on bars processed in one run, independent of `timeoutMs`. This
 * exists because `timeoutMs` is only checked BETWEEN bars — a pathological
 * strategy whose `onBar` itself never returns (a true infinite loop) cannot
 * be interrupted by a wall-clock check running on the same synchronous JS
 * thread. That case is what `sandbox.ts` running strategies inside a Web
 * Worker is for: a worker can be `terminate()`d from the outside no matter
 * what its code is doing. This cap is just the second line of defence for
 * runBacktest() called directly (as every test in runner.test.ts does).
 */
const HARD_BAR_CAP = 1_000_000;

/** Cap on `BacktestResult.logs`, per types.ts's BacktestResult doc. */
const MAX_LOGS = 500;

/**
 * Runs `strategy` over `bars`, oldest to newest, and returns every trade,
 * the equity curve, logs, and how far it got.
 *
 * NO-LOOKAHEAD GUARANTEE: on bar `i` the strategy is handed
 * `Object.freeze(bars.slice(0, i + 1))` — never the full array with an index
 * it could ignore. `bars[i + 1]` is therefore genuinely `undefined` inside
 * `onBar`, not just conventionally off-limits; there is no way for strategy
 * code to read the future even by mistake. See runner.test.ts's
 * "no-lookahead" case, which asserts this directly.
 *
 * FILL TIMING: an order requested on bar `i` (via ctx.buy/sell/close) fills
 * at bar `i + 1`'s open — never sooner. An order requested on the LAST bar
 * therefore never fills (there is no bar i+1); this is intentional, not a
 * bug, and mirrors real trading (you can't fill an order against a bar that
 * hasn't happened).
 *
 * EXIT-BEFORE-SIGNAL: before the strategy runs for bar `i`, any position
 * already open (including one that just filled at this bar's open) is
 * checked against bar `i`'s range for a stop/target hit. Only if it survives
 * that check does the strategy get to see the bar and issue a new signal —
 * so an exit always precedes a new entry on the same bar, never the reverse.
 *
 * ONE POSITION AT A TIME: a buy/sell while a position is already open is
 * silently ignored (a strategy wanting to pyramid or hedge is out of scope
 * for this engine — see docs/BACKTEST-ENGINE.md).
 */
export function runBacktest(bars: readonly Bar[], strategy: StrategyModule, config: BacktestConfig): BacktestResult {
  const { instrument, fill, initialBalance } = config;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const params = config.params ?? {};

  const trades: SimTrade[] = [];
  const equity: { ts: number; balance: number }[] = [{ ts: bars[0]?.ts ?? 0, balance: initialBalance }];
  const logs: string[] = [];
  let balance = initialBalance;
  let position: SimPosition | null = null;
  let pendingOrder: OrderRequest | null = null;
  let pendingClose: { reason?: string } | null = null;
  let error: string | undefined;
  let barsProcessed = 0;

  function log(message: string): void {
    if (logs.length < MAX_LOGS) logs.push(message);
  }

  function recordClose(price: number, ts: number, reason: SimTrade["exitReason"]): void {
    if (!position) return;
    const trade = closeAtPrice(position, price, ts, reason, fill, instrument);
    trades.push(trade);
    balance += trade.netPnl;
    equity.push({ ts, balance });
    position = null;
  }

  if (strategy.init) {
    try {
      strategy.init({ instrument, params, log });
    } catch (err) {
      return {
        trades,
        equity,
        logs,
        barsProcessed: 0,
        error: `Strategy init() threw: ${errorMessage(err)}`,
      };
    }
  }

  const startedAt = Date.now();
  const cap = Math.min(bars.length, HARD_BAR_CAP);

  for (let i = 0; i < cap; i++) {
    if (Date.now() - startedAt > timeoutMs) {
      error = `Backtest timed out after ${timeoutMs}ms at bar ${i} of ${bars.length}`;
      break;
    }

    const bar = bars[i];
    barsProcessed = i + 1;

    // 1. Fill any order requested on the PREVIOUS bar, at THIS bar's open.
    // (Snapshotting into a local const before narrowing, rather than
    // narrowing the closured `let` directly, sidesteps a TS control-flow
    // quirk across loop iterations with closures that reassign it.)
    // `as` (rather than a plain annotation) is required here: TS's control
    // flow analysis has a known quirk where narrowing a `let` that a
    // closure elsewhere reassigns (ctx.buy/sell below) collapses to `never`
    // under an `if (x && ...)` guard, even though an unconditional read of
    // the same variable widens correctly. The assertion sidesteps that
    // narrowing bug rather than working around real unsafety.
    const orderToFill = pendingOrder as OrderRequest | null;
    pendingOrder = null;
    if (orderToFill && !position) {
      const side = orderToFill.side;
      const price = entryPrice(bar, side, fill, instrument);
      position = {
        side,
        lots: orderToFill.lots,
        entryTs: bar.ts,
        entryPrice: price,
        stopLoss: orderToFill.stopLoss,
        takeProfit: orderToFill.takeProfit,
        reason: orderToFill.reason,
      };
    }

    // 2. Fill a close requested on the PREVIOUS bar, at THIS bar's open.
    const closeToFill = pendingClose as { reason?: string } | null;
    pendingClose = null;
    if (closeToFill && position) {
      const price = exitAtMarket(bar.open, position.side, fill, instrument, bar.spread ?? fill.spreadPoints);
      recordClose(price, bar.ts, "SIGNAL");
    }

    // 3. Exit-before-signal: check the (possibly just-filled) open position
    // against THIS bar's range before the strategy gets to act on this bar.
    if (position) {
      const hit = exitOnBar(position, bar, fill, instrument);
      if (hit) recordClose(hit.price, bar.ts, hit.reason);
    }

    // 4. Run the strategy on a frozen view that cannot see past this bar.
    const visibleBars = Object.freeze(bars.slice(0, i + 1));
    const equityNow = markToMarket(balance, position, bar, fill, instrument);

    const ctx: StrategyContext = {
      bars: visibleBars,
      i,
      bar,
      position,
      equity: equityNow,
      balance,
      instrument,
      params,
      buy(order) {
        if (position || pendingOrder) return;
        pendingOrder = { ...order, side: "LONG" };
      },
      sell(order) {
        if (position || pendingOrder) return;
        pendingOrder = { ...order, side: "SHORT" };
      },
      close(reason) {
        if (!position) return;
        pendingClose = { reason };
      },
      modify(update) {
        if (!position) return;
        if (update.stopLoss !== undefined) position.stopLoss = update.stopLoss;
        if (update.takeProfit !== undefined) position.takeProfit = update.takeProfit;
      },
      log,
    };

    try {
      strategy.onBar(ctx);
    } catch (err) {
      error = `Strategy onBar() threw at bar ${i}: ${errorMessage(err)}`;
      break;
    }
  }

  // Anything still open when we stop (ran out of bars, hit the cap, timed
  // out, or errored) is force-closed at the last bar actually processed —
  // never left dangling, and never at a price the strategy couldn't have
  // gotten (a real market-crossing exit, not the raw close).
  if (position && barsProcessed > 0) {
    const lastBar = bars[barsProcessed - 1];
    const price = exitAtMarket(lastBar.close, position.side, fill, instrument, lastBar.spread ?? fill.spreadPoints);
    recordClose(price, lastBar.ts, "END_OF_DATA");
  }

  return { trades, equity, logs, barsProcessed, error };
}

/** Mark-to-market equity: balance plus the unrealized P&L of any open
 * position, priced as if it were closed at market on this bar's close. This
 * is what ctx.equity reports; ctx.balance is the last REALIZED balance. */
function markToMarket(
  balance: number,
  position: SimPosition | null,
  bar: Bar,
  fill: BacktestConfig["fill"],
  instrument: SimInstrument,
): number {
  if (!position) return balance;
  const markPrice = exitAtMarket(bar.close, position.side, fill, instrument, bar.spread ?? fill.spreadPoints);
  const pips = pipsBetween(instrument, position.entryPrice, markPrice, position.side);
  const pipValuePerLot = instrument.pipSize * instrument.contractSize * fill.conversionRate;
  const unrealized = pips * pipValuePerLot * position.lots;
  return balance + unrealized;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What `toJournalTrade` needs beyond the `SimTrade` itself: everything a
 * journal Trade row requires that a backtest run supplies at the batch
 * level rather than per-trade (which account, which symbol, which run). */
export interface ToJournalTradeOptions {
  accountId: string;
  symbol: string;
  backtestRunId?: string;
}

/**
 * Shape of the fields `toJournalTrade` produces, matching `prisma.trade.create`'s
 * input for a finished backtest trade. Decimal-backed columns go out as
 * STRINGS (Prisma's Decimal accepts string input, and a string round-trips
 * exactly — unlike a JS number, which is exactly the float error the
 * metrics module's whole Decimal discipline exists to avoid). See
 * src/lib/metrics/decimal.ts's module doc for the "MONEY RULE" this mirrors
 * at the boundary between the sim (fast, float) and the journal (exact,
 * Decimal).
 */
export interface JournalTradeInput {
  accountId: string;
  symbol: string;
  direction: Side;
  status: "CLOSED";
  openedAt: Date;
  closedAt: Date;
  entryPrice: string;
  exitPrice: string;
  stopLoss?: string;
  takeProfit?: string;
  volumeLots: string;
  commission: string;
  grossPnl: string;
  netPnl: string;
  pips: string;
  rMultiple: string | null;
  riskAmount: string | null;
  holdingMinutes: number;
  marketSession: ReturnType<typeof marketSession>;
  backtestRunId?: string;
  notes?: string;
}

/**
 * Converts one finished `SimTrade` into the exact field set
 * `prisma.trade.create` needs to persist it as a journal Trade row. Reuses
 * `marketSession()` from src/lib/metrics rather than reimplementing session
 * classification a second time (there is exactly one definition of "what
 * session was this trade opened in" in this codebase).
 */
export function toJournalTrade(trade: SimTrade, opts: ToJournalTradeOptions): JournalTradeInput {
  const openedAt = new Date(trade.entryTs);
  const closedAt = new Date(trade.exitTs);

  return {
    accountId: opts.accountId,
    symbol: opts.symbol,
    direction: trade.side,
    status: "CLOSED",
    openedAt,
    closedAt,
    entryPrice: String(trade.entryPrice),
    exitPrice: String(trade.exitPrice),
    stopLoss: trade.stopLoss === undefined ? undefined : String(trade.stopLoss),
    takeProfit: trade.takeProfit === undefined ? undefined : String(trade.takeProfit),
    volumeLots: String(trade.lots),
    commission: String(trade.commission),
    grossPnl: String(trade.grossPnl),
    netPnl: String(trade.netPnl),
    pips: String(trade.pips),
    rMultiple: trade.rMultiple === null ? null : String(trade.rMultiple),
    riskAmount: trade.riskAmount === null ? null : String(trade.riskAmount),
    holdingMinutes: trade.holdingMinutes,
    marketSession: marketSession(openedAt),
    backtestRunId: opts.backtestRunId,
    notes: trade.reason,
  };
}
