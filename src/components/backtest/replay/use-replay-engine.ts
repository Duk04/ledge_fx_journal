"use client";

import * as React from "react";
import {
  closeAtPrice,
  entryPrice,
  exitAtMarket,
  exitOnBar,
  pipsBetween,
} from "@/lib/backtest/fill";
import type { Bar, FillModel, OrderRequest, SimInstrument, SimPosition, SimTrade } from "@/lib/backtest/types";

/**
 * Drives a manual replay session bar-by-bar in the browser. This is
 * deliberately NOT `runBacktest()` (that engine calls a `StrategyModule`'s
 * `onBar`, and replay has no strategy — a person clicks buttons instead) —
 * but it reuses every fill primitive `runBacktest` uses
 * (`entryPrice`/`exitOnBar`/`exitAtMarket`/`closeAtPrice`, all pure
 * functions with no engine-internal state), in the exact same order the
 * engine's loop applies them (see docs/BACKTEST-ENGINE.md), so a replay
 * session and a strategy run agree about what "a fill" means down to the
 * same spread/slippage/gap rules. Reimplementing that arithmetic here would
 * be the one thing the task explicitly rules out.
 */

const SPEEDS = [0.5, 1, 2, 5, "max"] as const;
export type ReplaySpeed = (typeof SPEEDS)[number];
/** Milliseconds between bars at 1x. */
const BASE_INTERVAL_MS = 700;
/** "max" still yields to the event loop between bars (so the UI stays
 * responsive and Pause remains clickable) rather than running a synchronous
 * loop over the whole series. */
const MAX_INTERVAL_MS = 15;

export interface PendingOrderDraft {
  side: "LONG" | "SHORT";
  lots: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface UseReplayEngineArgs {
  bars: readonly Bar[];
  instrument: SimInstrument;
  fill: FillModel;
  initialBalance: number;
  /** How many bars are visible before the user starts stepping — enough
   * context to read the chart, without simply showing the whole future. */
  warmupBars?: number;
  /** Called once per trade the instant it closes, so the caller can persist
   * it (`recordReplayTrade`) without this hook knowing anything about the
   * server. */
  onTradeClosed?: (trade: SimTrade) => void;
}

export function useReplayEngine({
  bars,
  instrument,
  fill,
  initialBalance,
  warmupBars = 60,
  onTradeClosed,
}: UseReplayEngineArgs) {
  const [cursor, setCursor] = React.useState(() => Math.min(warmupBars, Math.max(0, bars.length - 1)));
  const [position, setPosition] = React.useState<SimPosition | null>(null);
  const [pendingOrder, setPendingOrder] = React.useState<OrderRequest | null>(null);
  const [pendingClose, setPendingClose] = React.useState(false);
  const [balance, setBalance] = React.useState(initialBalance);
  const [trades, setTrades] = React.useState<SimTrade[]>([]);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<ReplaySpeed>(1);

  const atEnd = cursor >= bars.length - 1;
  const visibleBars = React.useMemo(() => bars.slice(0, cursor + 1), [bars, cursor]);
  const currentBar = bars[cursor];

  const equity = React.useMemo(() => {
    if (!position || !currentBar) return balance;
    const markPrice = exitAtMarket(currentBar.close, position.side, fill, instrument, currentBar.spread ?? fill.spreadPoints);
    const pips = pipsBetween(instrument, position.entryPrice, markPrice, position.side);
    const pipValuePerLot = instrument.pipSize * instrument.contractSize * fill.conversionRate;
    return balance + pips * pipValuePerLot * position.lots;
  }, [position, currentBar, balance, fill, instrument]);

  const closeTrade = React.useCallback(
    (price: number, ts: number, reason: SimTrade["exitReason"], pos: SimPosition) => {
      const trade = closeAtPrice(pos, price, ts, reason, fill, instrument);
      setTrades((prev) => [...prev, trade]);
      setBalance((prev) => prev + trade.netPnl);
      setPosition(null);
      onTradeClosed?.(trade);
      return trade;
    },
    [fill, instrument, onTradeClosed],
  );

  /**
   * Advances one bar, applying the same four-step order `runBacktest` uses:
   * fill a pending entry, fill a pending close, check the (possibly
   * just-filled) position against this bar's range, then hand the bar to
   * whoever's watching (here: just moving the cursor — there's no `onBar`
   * to call).
   *
   * Reads `cursor`/`position`/`pendingOrder`/`pendingClose` directly from
   * this closure rather than through a `setCursor(prev => ...)` functional
   * updater. `closeTrade` calls the caller-supplied `onTradeClosed` (which
   * kicks off `recordReplayTrade`, a real network write) — and a state
   * updater function is not guaranteed to run exactly once (React
   * deliberately invokes updaters twice in development Strict Mode to
   * surface impure ones), so a network-writing side effect must not live
   * inside one. `stepForward` is recreated whenever the values it reads
   * change (see the dependency list), so the closure is never stale.
   */
  const stepForward = React.useCallback(() => {
    if (cursor >= bars.length - 1) return;
    const nextIndex = cursor + 1;
    const bar = bars[nextIndex];

    let nextPosition = position;

    if (pendingOrder && !nextPosition) {
      const price = entryPrice(bar, pendingOrder.side, fill, instrument);
      nextPosition = {
        side: pendingOrder.side,
        lots: pendingOrder.lots,
        entryTs: bar.ts,
        entryPrice: price,
        stopLoss: pendingOrder.stopLoss,
        takeProfit: pendingOrder.takeProfit,
        reason: pendingOrder.reason,
      };
      setPosition(nextPosition);
      setPendingOrder(null);
    }

    if (pendingClose && nextPosition) {
      const price = exitAtMarket(bar.open, nextPosition.side, fill, instrument, bar.spread ?? fill.spreadPoints);
      closeTrade(price, bar.ts, "SIGNAL", nextPosition);
      nextPosition = null;
      setPendingClose(false);
    }

    if (nextPosition) {
      const hit = exitOnBar(nextPosition, bar, fill, instrument);
      if (hit) closeTrade(hit.price, bar.ts, hit.reason, nextPosition);
    }

    setCursor(nextIndex);
  }, [cursor, bars, fill, instrument, closeTrade, position, pendingOrder, pendingClose]);

  /** Rewinds the visible window by one bar, for reviewing price action —
   * NOT an undo. A trade already filled or closed stays filled/closed (it
   * may already be persisted via `onTradeClosed`); rewinding past it just
   * hides bars again, it does not reverse the fill. So this is a no-op
   * while a position or a pending order exists, rather than pretending to
   * roll back state it can't actually roll back. */
  const stepBack = React.useCallback(() => {
    if (position || pendingOrder) return;
    setCursor((prev) => Math.max(0, prev - 1));
  }, [position, pendingOrder]);

  const buy = React.useCallback(
    (order: Omit<PendingOrderDraft, "side">) => {
      if (position || pendingOrder) return;
      setPendingOrder({ side: "LONG", ...order });
    },
    [position, pendingOrder],
  );

  const sell = React.useCallback(
    (order: Omit<PendingOrderDraft, "side">) => {
      if (position || pendingOrder) return;
      setPendingOrder({ side: "SHORT", ...order });
    },
    [position, pendingOrder],
  );

  const cancelPendingOrder = React.useCallback(() => setPendingOrder(null), []);

  const requestClose = React.useCallback(() => {
    if (!position) return;
    setPendingClose(true);
  }, [position]);

  const modify = React.useCallback((update: { stopLoss?: number; takeProfit?: number }) => {
    setPosition((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        stopLoss: update.stopLoss !== undefined ? update.stopLoss : prev.stopLoss,
        takeProfit: update.takeProfit !== undefined ? update.takeProfit : prev.takeProfit,
      };
    });
  }, []);

  /** Force-closes any open position at the current bar's close — the same
   * END_OF_DATA treatment `runBacktest` gives a position still open when a
   * run stops. Called before leaving a session so nothing is left dangling.
   * Reads `position` directly (see `stepForward`'s doc on why a state
   * updater is the wrong place for a call that persists to the server). */
  const finish = React.useCallback(() => {
    if (!position || !currentBar) return;
    const price = exitAtMarket(currentBar.close, position.side, fill, instrument, currentBar.spread ?? fill.spreadPoints);
    closeTrade(price, currentBar.ts, "END_OF_DATA", position);
  }, [position, currentBar, fill, instrument, closeTrade]);

  // ------------------------------------------------------------ playback
  // `stepRef`/`atEndRef` are kept current via their own effects (never
  // written during render) so the interval effect below can depend only on
  // [playing, speed] — recreating the interval on every fill/order change
  // would otherwise restart its timing each time a trade closes mid-play.
  const stepRef = React.useRef(stepForward);
  React.useEffect(() => {
    stepRef.current = stepForward;
  }, [stepForward]);

  const atEndRef = React.useRef(atEnd);
  React.useEffect(() => {
    atEndRef.current = atEnd;
  }, [atEnd]);

  React.useEffect(() => {
    if (!playing) return;
    const intervalMs = speed === "max" ? MAX_INTERVAL_MS : BASE_INTERVAL_MS / speed;
    const id = window.setInterval(() => {
      // Reached the end since this interval was scheduled: stop rather than
      // tick forever against a cursor that can no longer advance. Setting
      // state from inside the timer callback (not the effect body itself)
      // is the deferred, event-like context React's rules expect.
      if (atEndRef.current) {
        setPlaying(false);
        return;
      }
      stepRef.current();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [playing, speed]);

  const togglePlaying = React.useCallback(() => setPlaying((p) => !p), []);

  return {
    cursor,
    setCursor,
    visibleBars,
    currentBar,
    position,
    pendingOrder,
    pendingClose,
    balance,
    equity,
    trades,
    playing,
    speed,
    atEnd,
    setSpeed,
    togglePlaying,
    stepForward,
    stepBack,
    buy,
    sell,
    cancelPendingOrder,
    requestClose,
    modify,
    finish,
    SPEEDS,
  };
}
