"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Play, Pause, StepForward, StepBack, Keyboard, ArrowUpCircle, ArrowDownCircle, X } from "lucide-react";
import {
  Panel,
  PanelHeader,
  PanelBody,
  PanelFooter,
  Field,
  FieldLabel,
  NumberInput,
  Segmented,
  SegmentedItem,
  Button,
  Badge,
  DataTable,
  Th,
  Td,
  TableEmpty,
  Tip,
  useToast,
} from "@/components/ui";
import { Money, RValue, Pips } from "@/components/ui/value";
import { formatPrice } from "@/lib/metrics/formatters";
import { recordReplayTrade } from "@/lib/actions/backtests";
import type { Bar, FillModel, SimInstrument, SimTrade } from "@/lib/backtest/types";
import { useReplayEngine, type ReplaySpeed } from "./use-replay-engine";
import { CandlestickChart } from "./candlestick-chart";

const SPEED_LABEL: Record<Exclude<ReplaySpeed, "max">, string> = { 0.5: "0.5x", 1: "1x", 2: "2x", 5: "5x" };

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReplaySession({
  runId,
  symbol,
  bars,
  instrument,
  fill,
  initialBalance,
  currency,
}: {
  runId: string;
  symbol: string;
  bars: Bar[];
  instrument: SimInstrument;
  fill: FillModel;
  initialBalance: number;
  currency: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  // A ref so `handleSaveToJournal` can await the exact in-flight set (a
  // functional state update wouldn't hand back the promises themselves),
  // plus a plain counter kept in state purely so the footer's "Saving…"
  // text re-renders — mutating a ref alone does not.
  const inFlight = React.useRef<Set<Promise<unknown>>>(new Set());
  const [pendingSaves, setPendingSaves] = React.useState(0);

  const handleTradeClosed = React.useCallback(
    (trade: SimTrade) => {
      setPendingSaves((n) => n + 1);
      const p = recordReplayTrade(runId, trade)
        .then((res) => {
          if (!res.ok) toast({ title: "Couldn't save that trade", description: res.formError, tone: "loss" });
        })
        .finally(() => {
          inFlight.current.delete(p);
          setPendingSaves((n) => n - 1);
        });
      inFlight.current.add(p);
    },
    [runId, toast],
  );

  const engine = useReplayEngine({ bars, instrument, fill, initialBalance, onTradeClosed: handleTradeClosed });
  const {
    cursor,
    visibleBars,
    currentBar,
    position,
    pendingOrder,
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
    finish,
  } = engine;

  const [lots, setLots] = React.useState("1");
  const [stopLoss, setStopLoss] = React.useState("");
  const [takeProfit, setTakeProfit] = React.useState("");
  const [finishing, setFinishing] = React.useState(false);

  const digits = instrument.digits;
  const canOrder = !position && !pendingOrder;

  /**
   * Declared above the keyboard effect, and memoised, so that effect can list
   * it as a dependency.
   *
   * It previously sat below and was excluded via a suppression, on the
   * reasoning that every value it reads (`lots`, `stopLoss`, `takeProfit`,
   * `canOrder`) was already in the effect's dependency list — which was true,
   * and is exactly the kind of correctness that stops being true the moment
   * someone adds a fifth value here and does not think to update a list in
   * another part of the file. `toast`, `buy` and `sell` were already
   * missing from it.
   */
  const submitOrder = React.useCallback(
    (side: "LONG" | "SHORT") => {
      const lotsNum = Number(lots);
      if (!Number.isFinite(lotsNum) || lotsNum <= 0) {
        toast({ title: "Enter a lot size first", tone: "warn" });
        return;
      }
      const sl = stopLoss.trim() === "" ? undefined : Number(stopLoss);
      const tp = takeProfit.trim() === "" ? undefined : Number(takeProfit);
      const order = { lots: lotsNum, stopLoss: sl, takeProfit: tp };
      if (side === "LONG") buy(order);
      else sell(order);
    },
    [lots, stopLoss, takeProfit, toast, buy, sell],
  );

  // -------------------------------------------------------------- keyboard
  React.useEffect(() => {
    function isTyping(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      return el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlaying();
          break;
        case "ArrowRight":
          e.preventDefault();
          stepForward();
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepBack();
          break;
        case "b":
        case "B":
          if (canOrder) submitOrder("LONG");
          break;
        case "s":
        case "S":
          if (canOrder) submitOrder("SHORT");
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Re-subscribes whenever a lots/SL/TP keystroke changes `submitOrder`.
    // That is a `removeEventListener` plus an `addEventListener` on one
    // `window` listener — the original comment was right that it is cheap,
    // and it is now correct as well as cheap.
  }, [togglePlaying, stepForward, stepBack, canOrder, submitOrder]);

  async function handleSaveToJournal() {
    setFinishing(true);
    if (position) finish();
    // `finish()` (and every fill during play) enqueues a save into
    // `inFlight` synchronously — draining the set (which can still grow
    // while we wait, since `.finally` only removes entries) until it's
    // empty guarantees every trade from this session reached the server
    // before we navigate to the results page that reads them back.
    while (inFlight.current.size > 0) {
      await Promise.race(inFlight.current);
    }
    setFinishing(false);
    router.push(`/backtest/runs/${runId}`);
  }

  const floatingPnl = position ? equity - balance : 0;
  const sessionNetPnl = trades.reduce((a, t) => a + t.netPnl, 0);
  const wins = trades.filter((t) => t.netPnl > 0).length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="flex flex-col gap-3 xl:col-span-9">
        <Panel className="h-[65vh] min-h-96">
          <PanelHeader
            title={symbol}
            caption={currentBar ? formatTs(currentBar.ts) : undefined}
            actions={
              <Tip label="Space play/pause · → step · ← back · B buy · S sell">
                <span className="flex items-center gap-1 text-2xs text-ink-3">
                  <Keyboard className="size-3.5" /> shortcuts
                </span>
              </Tip>
            }
          />
          <PanelBody padded={false} className="h-full">
            <CandlestickChart
              bars={visibleBars}
              digits={digits}
              position={position}
              pendingStop={stopLoss.trim() === "" ? undefined : Number(stopLoss)}
              pendingTarget={takeProfit.trim() === "" ? undefined : Number(takeProfit)}
              className="h-full w-full"
            />
          </PanelBody>
          <PanelFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1">
              <Button
                variant="default"
                size="icon-sm"
                onClick={stepBack}
                disabled={Boolean(position || pendingOrder) || cursor === 0}
                aria-label="Step back"
              >
                <StepBack />
              </Button>
              {/* Placing orders is the primary action here; the transport and
                  "save" are secondary (docs/DESIGN-SYSTEM.md rule 1). */}
              <Button
                variant="default"
                size="icon-sm"
                onClick={togglePlaying}
                disabled={atEnd}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button variant="default" size="icon-sm" onClick={stepForward} disabled={atEnd} aria-label="Step forward">
                <StepForward />
              </Button>
            </div>
            <Segmented
              value={String(speed)}
              onValueChange={(v) => v && setSpeed((v === "max" ? "max" : Number(v)) as ReplaySpeed)}
            >
              {(["0.5", "1", "2", "5", "max"] as const).map((s) => (
                <SegmentedItem key={s} value={s}>
                  {s === "max" ? "max" : SPEED_LABEL[Number(s) as Exclude<ReplaySpeed, "max">]}
                </SegmentedItem>
              ))}
            </Segmented>
            <input
              type="range"
              min={0}
              max={bars.length - 1}
              value={cursor}
              disabled={Boolean(position || pendingOrder)}
              onChange={(e) => {
                if (position || pendingOrder) return;
                const idx = Number(e.target.value);
                // Scrubbing is a bulk version of stepBack's "review, don't
                // undo" rule — only reachable while flat, same as stepBack.
                if (idx <= cursor) {
                  for (let i = cursor; i > idx; i--) stepBack();
                }
              }}
              className="min-w-24 flex-1 accent-brand"
              aria-label="Bar position"
            />
            {currentBar ? (
              <span className="mono whitespace-nowrap text-2xs text-ink-3">
                O {formatPrice(currentBar.open, digits)} H {formatPrice(currentBar.high, digits)} L{" "}
                {formatPrice(currentBar.low, digits)} C {formatPrice(currentBar.close, digits)}
              </span>
            ) : null}
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader title="Order" caption={canOrder ? "flat" : position ? "in position" : "order pending"} />
          <PanelBody className="flex flex-wrap items-end gap-3">
            <Field className="w-24">
              <FieldLabel>Lots</FieldLabel>
              <NumberInput value={lots} onChange={(e) => setLots(e.target.value)} disabled={!canOrder} />
            </Field>
            <Field className="w-32">
              <FieldLabel optional>Stop loss</FieldLabel>
              <NumberInput
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                disabled={!canOrder}
                placeholder={formatPrice(currentBar?.close, digits)}
              />
            </Field>
            <Field className="w-32">
              <FieldLabel optional>Take profit</FieldLabel>
              <NumberInput
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                disabled={!canOrder}
                placeholder={formatPrice(currentBar?.close, digits)}
              />
            </Field>
            <div className="flex gap-1.5">
              <Button
                variant="primary"
                className="bg-profit hover:bg-profit"
                onClick={() => submitOrder("LONG")}
                disabled={!canOrder}
              >
                <ArrowUpCircle /> Buy
              </Button>
              <Button variant="danger" onClick={() => submitOrder("SHORT")} disabled={!canOrder}>
                <ArrowDownCircle /> Sell
              </Button>
              {pendingOrder ? (
                <Button variant="default" onClick={cancelPendingOrder}>
                  <X /> Cancel pending
                </Button>
              ) : null}
              {position ? (
                <Button variant="default" onClick={requestClose}>
                  Close position
                </Button>
              ) : null}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <div className="flex flex-col gap-3 xl:col-span-3">
        <Panel>
          <PanelHeader title="Position" />
          <PanelBody className="flex flex-col gap-2 text-sm">
            {pendingOrder ? (
              <p className="text-xs text-warn">
                Pending {pendingOrder.side} {pendingOrder.lots} lot(s) — fills at the next bar&rsquo;s open.
              </p>
            ) : position ? (
              <>
                <div className="flex items-center justify-between">
                  <Badge tone={position.side === "LONG" ? "profit" : "loss"}>{position.side}</Badge>
                  <span className="mono text-xs">{position.lots.toFixed(2)} lots</span>
                </div>
                <div className="mono flex justify-between text-xs text-ink-3">
                  <span>Entry</span>
                  <span className="text-ink">{formatPrice(position.entryPrice, digits)}</span>
                </div>
                {position.stopLoss !== undefined ? (
                  <div className="mono flex justify-between text-xs text-ink-3">
                    <span>Stop</span>
                    <span className="text-loss">{formatPrice(position.stopLoss, digits)}</span>
                  </div>
                ) : null}
                {position.takeProfit !== undefined ? (
                  <div className="mono flex justify-between text-xs text-ink-3">
                    <span>Target</span>
                    <span className="text-profit">{formatPrice(position.takeProfit, digits)}</span>
                  </div>
                ) : null}
                <div className="mt-1 flex justify-between border-t border-line pt-2 text-xs">
                  <span className="text-ink-3">Floating P&amp;L</span>
                  <Money value={floatingPnl} currency={currency} signed />
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-3">Flat — no open position.</p>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Session" caption={`${trades.length} trade(s)`} />
          <PanelBody className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col">
                <span className="text-ink-3">Balance</span>
                <Money value={balance} currency={currency} className="text-sm" />
              </div>
              <div className="flex flex-col">
                <span className="text-ink-3">Session P&amp;L</span>
                <Money value={sessionNetPnl} currency={currency} signed className="text-sm" />
              </div>
            </div>
            <div className="scroll-x max-h-64">
              <DataTable>
                <thead>
                  <tr>
                    <Th>Side</Th>
                    <Th numeric>Pips</Th>
                    <Th numeric>Net</Th>
                    <Th numeric>R</Th>
                  </tr>
                </thead>
                <tbody>
                  {trades
                    .slice()
                    .reverse()
                    .map((t, i) => (
                      <tr key={i}>
                        <Td>
                          <Badge tone={t.side === "LONG" ? "profit" : "loss"} className="mono">
                            {t.side}
                          </Badge>
                        </Td>
                        <Td numeric>
                          <Pips value={t.pips} />
                        </Td>
                        <Td numeric>
                          <Money value={t.netPnl} currency={currency} signed />
                        </Td>
                        <Td numeric>
                          <RValue value={t.rMultiple} />
                        </Td>
                      </tr>
                    ))}
                  {trades.length === 0 ? <TableEmpty colSpan={4}>No closed trades yet.</TableEmpty> : null}
                </tbody>
              </DataTable>
            </div>
            <p className="text-2xs text-ink-3">
              {trades.length > 0
                ? `${wins}/${trades.length} winners this session.`
                : "Place your first trade with Buy/Sell."}
            </p>
          </PanelBody>
          <PanelFooter>
            <span className="text-2xs text-ink-3">{pendingSaves > 0 ? "Saving…" : "Up to date"}</span>
            <Button variant="default" size="sm" onClick={handleSaveToJournal} disabled={finishing}>
              {finishing ? "Saving…" : "Save to journal"}
            </Button>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}
