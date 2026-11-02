"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Play, Pause, StepForward, StepBack, ArrowUpCircle, ArrowDownCircle, X } from "lucide-react";
import type { Timeframe } from "@prisma/client";
import {
  Money,
  RValue,
  Pips,
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
  useToast,
} from "@/components/ui";
import { formatInZone, formatMoney, formatPrice } from "@/lib/metrics/formatters";
import { aggregateBars } from "@/lib/candles/aggregate";
import { defaultPositionTool, positionToolStats } from "@/lib/backtest/replay-tools";
import type { Bar, FillModel, SimInstrument } from "@/lib/backtest/types";
import { useReplayEngine, type ReplaySpeed } from "./use-replay-engine";
import { CandlestickChart, type ChartTool, type ChartTools } from "./candlestick-chart";
import { ReplayToolbar, type PositionToolSide } from "./replay-toolbar";
import { useReplayDrawings } from "./use-replay-drawings";
import { useReplayHotkeys } from "./use-replay-hotkeys";
import { useReplayPersistence } from "./use-replay-persistence";
import type { PositionScene } from "./drawings-primitive";
import { TIMEFRAMES } from "@/lib/timeframes";

const SPEED_STEPS: readonly ReplaySpeed[] = [0.5, 1, 2, 5, "max"];

const SPEED_LABEL: Record<Exclude<ReplaySpeed, "max">, string> = { 0.5: "0.5x", 1: "1x", 2: "2x", 5: "5x" };

export function ReplaySession({
  runId,
  symbol,
  bars,
  instrument,
  fill,
  initialBalance,
  currency,
  timeframe,
  timezone,
}: {
  runId: string;
  /** The user's, so the bar time reads the same on the server and in the
   * browser. `toLocaleString()` used the host's zone on each side, and the
   * two disagreed whenever the server ran in another zone — a hydration
   * mismatch on every replay page. */
  timezone: string;
  symbol: string;
  /** The bars' own timeframe; the second chart offers the coarser ones. */
  timeframe: Timeframe;
  bars: Bar[];
  instrument: SimInstrument;
  fill: FillModel;
  initialBalance: number;
  currency: string;
}) {
  const t = useTranslations("backtest");
  const router = useRouter();
  const { toast } = useToast();
  const saves = useReplayPersistence(runId);

  const engine = useReplayEngine({ bars, instrument, fill, initialBalance, onTradeClosed: saves.onTradeClosed });
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
    modify,
    finish,
  } = engine;

  const [lots, setLots] = React.useState("1");
  const [stopLoss, setStopLoss] = React.useState("");
  const [takeProfit, setTakeProfit] = React.useState("");
  const [finishing, setFinishing] = React.useState(false);

  const digits = instrument.digits;
  const canOrder = !position && !pendingOrder;

  // ------------------------------------------------------------ chart tools
  const draw = useReplayDrawings(runId);
  const [tool, setTool] = React.useState<ChartTool>("cursor");
  /** The position tool while flat: entry at the last close, stop and
   * target in the order fields, lots from the risk %. */
  const [positionSide, setPositionSide] = React.useState<PositionToolSide>(null);
  const [riskPct, setRiskPct] = React.useState("1");
  const toolActive = positionSide !== null && canOrder;
  const round = React.useCallback((price: number) => Number(price.toFixed(digits)), [digits]);

  const startPositionTool = React.useCallback(
    (side: PositionToolSide) => {
      setPositionSide(side);
      if (!side || !currentBar) return;
      const plan = defaultPositionTool(side, currentBar.close, instrument);
      setStopLoss(String(round(plan.stop)));
      setTakeProfit(String(round(plan.target)));
    },
    [currentBar, instrument, round],
  );

  const toolStats = React.useMemo(() => {
    if (!toolActive || !currentBar) return null;
    const stop = Number(stopLoss);
    const target = Number(takeProfit);
    if (!stopLoss.trim() || !takeProfit.trim() || !Number.isFinite(stop) || !Number.isFinite(target)) return null;
    return positionToolStats(
      { side: positionSide!, entry: currentBar.close, stop, target },
      { instrument, balance, riskPct: Number(riskPct) || 0, conversionRate: fill.conversionRate },
    );
  }, [toolActive, currentBar, stopLoss, takeProfit, positionSide, instrument, balance, riskPct, fill.conversionRate]);

  /** What an order would be sized at: the tool's risk-based lots while it
   * is out, otherwise whatever was typed. */
  const orderLots = toolActive ? (toolStats?.lots ?? 0) : Number(lots);

  // ------------------------------------------------------------ second chart
  const htfOptions = React.useMemo(() => TIMEFRAMES.slice(TIMEFRAMES.indexOf(timeframe) + 1), [timeframe]);
  const [htf, setHtf] = React.useState<Timeframe | null>(null);
  const lastHtf = React.useRef<Timeframe | null>(null);
  const chooseHtf = React.useCallback((tf: Timeframe | null) => {
    if (tf) lastHtf.current = tf;
    setHtf(tf);
  }, []);
  // Built from the bars shown so far, so the newest higher-timeframe candle
  // is still forming — it never shows the rest of a period that has not
  // been replayed yet.
  const htfBars = React.useMemo(
    () => (htf ? aggregateBars(visibleBars, timeframe, htf) : []),
    [htf, visibleBars, timeframe],
  );
  /** Places the ticket's order — from the buttons and from B/S. */
  const submitOrder = React.useCallback(
    (side: "LONG" | "SHORT") => {
      const lotsNum = orderLots;
      if (toolActive && toolStats && !toolStats.valid) {
        toast({ title: t("replay.toolInvalid"), tone: "warn" });
        return;
      }
      if (!Number.isFinite(lotsNum) || lotsNum <= 0) {
        toast({ title: t("replay.enterLots"), tone: "warn" });
        return;
      }
      const sl = stopLoss.trim() === "" ? undefined : Number(stopLoss);
      const tp = takeProfit.trim() === "" ? undefined : Number(takeProfit);
      const order = { lots: lotsNum, stopLoss: sl, takeProfit: tp };
      if (side === "LONG") buy(order);
      else sell(order);
      // The plan became an order; its zones now follow the position.
      setPositionSide(null);
    },
    [orderLots, toolActive, toolStats, stopLoss, takeProfit, toast, buy, sell, t],
  );

  // -------------------------------------------------------------- keyboard
  useReplayHotkeys({
    undo: draw.undo,
    togglePlaying,
    stepForward,
    stepBack,
    changeSpeed: (direction) => {
      const i = SPEED_STEPS.indexOf(speed);
      setSpeed(SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, i + direction))]);
    },
    canOrder,
    order: submitOrder,
    togglePositionTool: (side) => startPositionTool(positionSide === side ? null : side),
    close: requestClose,
    cancelPending: cancelPendingOrder,
    setTool,
    toggleHigherTimeframe: () => {
      if (htfOptions.length) chooseHtf(htf ? null : (lastHtf.current ?? htfOptions[0]));
    },
    escape: () => {
      setTool("cursor");
      draw.select(null);
      setPositionSide(null);
    },
    removeSelected: draw.removeSelected,
  });

  // ------------------------------------------------------------ chart scene
  const money = React.useCallback((n: number) => formatMoney(n, currency), [currency]);
  const positionScene = React.useMemo<PositionScene | null>(() => {
    const pipsOf = (a: number, b: number) => (Math.abs(a - b) / instrument.pipSize).toFixed(1);
    if (position) {
      const fromIndex = Math.max(
        0,
        bars.findIndex((b) => b.ts >= position.entryTs),
      );
      const perPip = instrument.pipSize * instrument.contractSize * fill.conversionRate * position.lots;
      const sl = position.stopLoss ?? null;
      const tp = position.takeProfit ?? null;
      return {
        side: position.side,
        entry: position.entryPrice,
        stop: sl,
        target: tp,
        fromIndex,
        valid: true,
        stopLabel:
          sl === null
            ? ""
            : t("replay.positionStop", {
                pips: pipsOf(sl, position.entryPrice),
                money: money((Math.abs(sl - position.entryPrice) / instrument.pipSize) * perPip),
              }),
        targetLabel:
          tp === null
            ? ""
            : t("replay.positionTarget", {
                pips: pipsOf(tp, position.entryPrice),
                money: money((Math.abs(tp - position.entryPrice) / instrument.pipSize) * perPip),
              }),
      };
    }
    if (!toolActive || !currentBar || !toolStats) return null;
    const rr = toolStats.rr === null ? "—" : toolStats.rr.toFixed(2);
    return {
      side: positionSide!,
      entry: currentBar.close,
      stop: Number(stopLoss),
      target: Number(takeProfit),
      fromIndex: cursor,
      valid: toolStats.valid,
      stopLabel:
        toolStats.lots === null
          ? t("replay.toolStopNoSize", { pips: toolStats.stopPips.toFixed(1) })
          : t("replay.toolStop", {
              pips: toolStats.stopPips.toFixed(1),
              money: money(toolStats.riskAmount ?? 0),
              lots: toolStats.lots.toFixed(2),
            }),
      targetLabel:
        toolStats.lots === null
          ? t("replay.toolTargetNoSize", { pips: toolStats.targetPips.toFixed(1), rr })
          : t("replay.toolTarget", {
              pips: toolStats.targetPips.toFixed(1),
              rr,
              money: money(toolStats.rewardAmount ?? 0),
            }),
    };
  }, [
    position,
    bars,
    instrument,
    fill.conversionRate,
    toolActive,
    currentBar,
    toolStats,
    positionSide,
    stopLoss,
    takeProfit,
    cursor,
    money,
    t,
  ]);

  const onDragPosition = React.useCallback(
    (handle: "stop" | "target", price: number) => {
      const value = round(price);
      if (position) modify(handle === "stop" ? { stopLoss: value } : { takeProfit: value });
      else if (handle === "stop") setStopLoss(String(value));
      else setTakeProfit(String(value));
    },
    [position, modify, round],
  );

  const chartTools = React.useMemo<ChartTools>(
    () => ({
      tool,
      drawings: draw.drawings,
      selectedId: draw.selectedId,
      onAddDrawing: draw.add,
      onSelect: draw.select,
      position: positionScene,
      onDragPosition: positionScene ? onDragPosition : undefined,
    }),
    [tool, draw.drawings, draw.selectedId, draw.add, draw.select, positionScene, onDragPosition],
  );

  async function handleSaveToJournal() {
    setFinishing(true);
    if (position) finish();
    // `finish()` (and every fill during play) enqueues a save; draining
    // waits for all of them — the results page reads them back.
    const failed = await saves.drain();
    setFinishing(false);
    if (failed > 0) {
      toast({ title: t("replay.unsavedTrades", { count: failed }), tone: "warn" });
      return;
    }
    router.push(`/backtest/runs/${runId}`);
  }

  const floatingPnl = position ? equity - balance : 0;
  const sessionNetPnl = trades.reduce((a, trade) => a + trade.netPnl, 0);
  const wins = trades.filter((trade) => trade.netPnl > 0).length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="flex flex-col gap-3 xl:col-span-9">
        <Panel className="h-[65vh] min-h-96">
          <PanelHeader
            title={symbol}
            caption={currentBar ? formatInZone(new Date(currentBar.ts), timezone, "MMM dd, HH:mm") : undefined}
          />
          <div className="border-b border-line px-2 py-1">
            <ReplayToolbar
              tool={tool}
              onTool={setTool}
              positionSide={toolActive ? positionSide : null}
              onPositionSide={startPositionTool}
              positionDisabled={!canOrder}
              canUndo={draw.drawings.length > 0}
              hasSelection={draw.selectedId !== null}
              onUndo={draw.undo}
              onDeleteSelected={draw.removeSelected}
              onClearAll={draw.clear}
              htfOptions={htfOptions}
              htf={htf}
              onHtf={chooseHtf}
            />
          </div>
          <PanelBody
            padded={false}
            className={htf ? "grid h-full min-h-0 grid-cols-1 lg:grid-cols-2" : "h-full min-h-0"}
          >
            <CandlestickChart
              bars={visibleBars}
              digits={digits}
              position={position}
              pendingStop={stopLoss.trim() === "" ? undefined : Number(stopLoss)}
              pendingTarget={takeProfit.trim() === "" ? undefined : Number(takeProfit)}
              tools={chartTools}
              className="h-full min-h-64 w-full"
            />
            {htf ? (
              <div className="relative h-full min-h-64 border-t border-line lg:border-t-0 lg:border-l">
                <span className="pointer-events-none absolute top-1.5 left-2 z-10 text-2xs font-medium text-ink-3">
                  {symbol} · {htf}
                </span>
                <CandlestickChart bars={htfBars} digits={digits} position={position} className="h-full w-full" />
              </div>
            ) : null}
          </PanelBody>
          <PanelFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1">
              <Button
                variant="default"
                size="icon-sm"
                onClick={stepBack}
                disabled={Boolean(position || pendingOrder) || cursor === 0}
                aria-label={t("replay.stepBack")}
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
                aria-label={playing ? t("replay.pause") : t("replay.play")}
              >
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button
                variant="default"
                size="icon-sm"
                onClick={() => stepForward()}
                disabled={atEnd}
                aria-label={t("replay.stepForward")}
              >
                <StepForward />
              </Button>
            </div>
            <Segmented
              value={String(speed)}
              onValueChange={(v) => v && setSpeed((v === "max" ? "max" : Number(v)) as ReplaySpeed)}
            >
              {(["0.5", "1", "2", "5", "max"] as const).map((s) => (
                <SegmentedItem key={s} value={s}>
                  {s === "max" ? t("replay.max") : SPEED_LABEL[Number(s) as Exclude<ReplaySpeed, "max">]}
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
              aria-label={t("replay.barPosition")}
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
          <PanelHeader
            title={t("replay.order")}
            caption={canOrder ? t("replay.flat") : position ? t("replay.inPosition") : t("replay.orderPending")}
          />
          <PanelBody className="flex flex-wrap items-end gap-3">
            {toolActive ? (
              <Field className="w-24">
                <FieldLabel>{t("replay.riskPct")}</FieldLabel>
                <NumberInput value={riskPct} onChange={(e) => setRiskPct(e.target.value)} unit="%" />
              </Field>
            ) : null}
            <Field className="w-28">
              <FieldLabel>{t("replay.lots")}</FieldLabel>
              <NumberInput
                value={position ? position.lots.toFixed(2) : toolActive ? (toolStats?.lots?.toFixed(2) ?? "") : lots}
                onChange={(e) => setLots(e.target.value)}
                disabled={!canOrder}
                readOnly={toolActive}
                title={toolActive ? t("replay.lotsFromRisk", { pct: riskPct }) : undefined}
              />
            </Field>
            <Field className="w-32">
              <FieldLabel optional>{t("replay.stopLoss")}</FieldLabel>
              <NumberInput
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                disabled={!canOrder}
                placeholder={formatPrice(currentBar?.close, digits)}
              />
            </Field>
            <Field className="w-32">
              <FieldLabel optional>{t("replay.takeProfit")}</FieldLabel>
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
                <ArrowUpCircle /> {t("replay.buy")}
              </Button>
              <Button variant="danger" onClick={() => submitOrder("SHORT")} disabled={!canOrder}>
                <ArrowDownCircle /> {t("replay.sell")}
              </Button>
              {pendingOrder ? (
                <Button variant="default" onClick={cancelPendingOrder}>
                  <X /> {t("replay.cancelPending")}
                </Button>
              ) : null}
              {position ? (
                <Button variant="default" onClick={requestClose}>
                  {t("replay.closePosition")}
                </Button>
              ) : null}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <div className="flex flex-col gap-3 xl:col-span-3">
        <Panel>
          <PanelHeader title={t("replay.position")} />
          <PanelBody className="flex flex-col gap-2 text-sm">
            {pendingOrder ? (
              <p className="text-xs text-warn">
                {t("replay.pendingOrder", { side: t(`side.${pendingOrder.side}`), lots: String(pendingOrder.lots) })}
              </p>
            ) : position ? (
              <>
                <div className="flex items-center justify-between">
                  <Badge tone={position.side === "LONG" ? "profit" : "loss"}>{t(`side.${position.side}`)}</Badge>
                  <span className="mono text-xs">{t("replay.lotsValue", { lots: position.lots.toFixed(2) })}</span>
                </div>
                <div className="mono flex justify-between text-xs text-ink-3">
                  <span>{t("replay.entry")}</span>
                  <span className="text-ink">{formatPrice(position.entryPrice, digits)}</span>
                </div>
                {position.stopLoss !== undefined ? (
                  <div className="mono flex justify-between text-xs text-ink-3">
                    <span>{t("replay.stop")}</span>
                    <span className="text-loss">{formatPrice(position.stopLoss, digits)}</span>
                  </div>
                ) : null}
                {position.takeProfit !== undefined ? (
                  <div className="mono flex justify-between text-xs text-ink-3">
                    <span>{t("replay.target")}</span>
                    <span className="text-profit">{formatPrice(position.takeProfit, digits)}</span>
                  </div>
                ) : null}
                <div className="mt-1 flex justify-between border-t border-line pt-2 text-xs">
                  <span className="text-ink-3">{t("replay.floatingPnl")}</span>
                  <Money value={floatingPnl} currency={currency} signed />
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-3">{t("replay.flatNoPosition")}</p>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title={t("replay.session")}
            caption={t("replay.tradesCaption", { count: String(trades.length) })}
          />
          <PanelBody className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col">
                <span className="text-ink-3">{t("replay.balance")}</span>
                <Money value={balance} currency={currency} className="text-sm" />
              </div>
              <div className="flex flex-col">
                <span className="text-ink-3">{t("replay.sessionPnl")}</span>
                <Money value={sessionNetPnl} currency={currency} signed className="text-sm" />
              </div>
            </div>
            <div className="scroll-x max-h-64">
              <DataTable>
                <thead>
                  <tr>
                    <Th>{t("replay.side")}</Th>
                    <Th numeric>{t("replay.pips")}</Th>
                    <Th numeric>{t("replay.net")}</Th>
                    <Th numeric>R</Th>
                  </tr>
                </thead>
                <tbody>
                  {trades
                    .slice()
                    .reverse()
                    .map((trade, i) => (
                      <tr key={i}>
                        <Td>
                          <Badge tone={trade.side === "LONG" ? "profit" : "loss"} className="mono">
                            {t(`side.${trade.side}`)}
                          </Badge>
                        </Td>
                        <Td numeric>
                          <Pips value={trade.pips} />
                        </Td>
                        <Td numeric>
                          <Money value={trade.netPnl} currency={currency} signed />
                        </Td>
                        <Td numeric>
                          <RValue value={trade.rMultiple} />
                        </Td>
                      </tr>
                    ))}
                  {trades.length === 0 ? <TableEmpty colSpan={4}>{t("replay.noClosed")}</TableEmpty> : null}
                </tbody>
              </DataTable>
            </div>
            <p className="text-2xs text-ink-3">
              {trades.length > 0
                ? t("replay.winners", { wins: String(wins), total: String(trades.length) })
                : t("replay.firstTrade")}
            </p>
          </PanelBody>
          <PanelFooter>
            <span className="text-2xs text-ink-3">{saves.pending > 0 ? t("replay.saving") : t("replay.upToDate")}</span>
            <Button variant="default" size="sm" onClick={handleSaveToJournal} disabled={finishing}>
              {finishing ? t("replay.saving") : t("replay.saveToJournal")}
            </Button>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}
