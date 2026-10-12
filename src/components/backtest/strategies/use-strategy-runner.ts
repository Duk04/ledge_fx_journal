"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { BacktestConfig, BacktestResult, Bar, SimInstrument } from "@/lib/backtest/types";
import type { SandboxRunRequest, SandboxRunResponse } from "@/lib/backtest/worker";

/**
 * Runs a strategy in a Web Worker and hands back the result.
 *
 * This is the host side of src/lib/backtest/worker.ts, and it is where the
 * server-side-RCE fix actually lands: the strategy's source never leaves the
 * browser, so `new Function` only ever compiles the author's own code in the
 * author's own tab.
 *
 * Two things this can do that the server could not:
 *
 *  - Kill a runaway strategy. `runBacktest`'s timeout is checked between
 *    bars, so `while (true) {}` inside a single `onBar` was uninterruptible
 *    and pinned a request thread until the platform gave up. `terminate()`
 *    has no such gap.
 *  - Report progress and failure without a round trip.
 */

/**
 * Wall-clock ceiling for one run, enforced from out here.
 *
 * Deliberately longer than the engine's own DEFAULT_TIMEOUT_MS (10s): that
 * one is a cooperative check between bars and fires first for a merely slow
 * strategy, with a useful "timed out after N bars" message. This is the
 * backstop for code that never returns control at all, so it only needs to
 * be short enough that a wedged tab doesn't look broken forever.
 */
export const RUN_WALL_CLOCK_MS = 30_000;

export interface StrategyRunOutcome {
  ok: boolean;
  /** Present when ok. */
  result?: BacktestResult;
  /** Present when not ok. */
  error?: string;
}

export interface FetchBarsParams {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
}

/** Shape /api/backtest/bars returns. */
export interface BarsPayload {
  bars: Bar[];
  /** Server-derived from the shared Instrument table, not the client's guess. */
  instrument: SimInstrument;
  /** Server-derived; scales every P&L figure in the run. */
  conversionRate: number;
  /** Set when the requested timeframe was rolled up from a finer one. */
  aggregatedFrom: string | null;
}

interface BarsResponse extends Partial<BarsPayload> {
  error?: string;
}

export function useStrategyRunner() {
  // Only this host side's own messages are translated. An error the worker
  // or the bars endpoint sends back is passed through as written.
  const t = useTranslations("backtest.runner");
  const workerRef = useRef<Worker | null>(null);

  const disposeWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  // A run in flight when the component unmounts (navigating away from a slow
  // run) would otherwise leave the worker alive holding its bar array.
  useEffect(() => disposeWorker, [disposeWorker]);

  const fetchBars = useCallback(
    async (params: FetchBarsParams): Promise<BarsPayload> => {
      const qs = new URLSearchParams({
        symbol: params.symbol,
        timeframe: params.timeframe,
        from: params.from,
        to: params.to,
      });

      const response = await fetch(`/api/backtest/bars?${qs.toString()}`);
      const body: BarsResponse = await response.json().catch(() => ({}) as BarsResponse);

      if (!response.ok) {
        // The endpoint's 413/422 bodies carry a message written for a person —
        // "narrow the dates", "import more data" — so prefer it over a status.
        throw new Error(body.error ?? t("loadFailed", { status: String(response.status) }));
      }
      if (!body.bars || body.bars.length === 0) {
        throw new Error(t("noBars"));
      }
      if (!body.instrument) {
        throw new Error(t("noInstrument"));
      }
      return {
        bars: body.bars,
        instrument: body.instrument,
        conversionRate: body.conversionRate ?? 1,
        aggregatedFrom: body.aggregatedFrom ?? null,
      };
    },
    [t],
  );

  const run = useCallback(
    async (args: { code: string; bars: Bar[]; config: BacktestConfig }): Promise<StrategyRunOutcome> => {
      disposeWorker();

      // `new URL(..., import.meta.url)` is the form bundlers recognise, so the
      // worker is emitted as its own chunk rather than inlined or missed.
      const worker = new Worker(new URL("@/lib/backtest/worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;

      return new Promise<StrategyRunOutcome>((resolve) => {
        let settled = false;
        const finish = (outcome: StrategyRunOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          disposeWorker();
          resolve(outcome);
        };

        const timer = setTimeout(() => {
          finish({
            ok: false,
            error: t("timedOut", { seconds: String(RUN_WALL_CLOCK_MS / 1000) }),
          });
        }, RUN_WALL_CLOCK_MS);

        worker.onmessage = (event: MessageEvent<SandboxRunResponse>) => {
          const data = event.data;
          if (data.ok) finish({ ok: true, result: data.result });
          else finish({ ok: false, error: data.error });
        };

        worker.onerror = (event) => {
          finish({ ok: false, error: event.message || t("crashed") });
        };

        const request: SandboxRunRequest = { code: args.code, bars: args.bars, config: args.config };
        worker.postMessage(request);
      });
    },
    [disposeWorker, t],
  );

  return { fetchBars, run, cancel: disposeWorker };
}
