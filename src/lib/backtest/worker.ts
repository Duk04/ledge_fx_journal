/**
 * Web Worker entry point for running a strategy.
 *
 * This is where untrusted strategy code executes: in the author's own browser,
 * in a worker the host page can `terminate()`. Two things follow from that,
 * and both are the point of this file existing:
 *
 *  1. The code never reaches the server, so `compileStrategy`'s documented
 *     inability to contain hostile code stops mattering — the only thing in
 *     reach is the author's own tab.
 *  2. A runaway `while (true)` is actually killable. On the server it was not:
 *     `runBacktest`'s timeout only fires between bars, so a strategy that
 *     hangs inside a single `onBar` call pinned a request thread until the
 *     platform gave up. `terminate()` has no such gap.
 *
 * The host side is `src/components/backtest/strategies/use-strategy-runner.ts`.
 */
import { compileStrategy } from "./sandbox";
import { runBacktest } from "./runner";
import type { Bar, BacktestConfig } from "./types";

/** Message the host page posts in to run one backtest. */
export interface SandboxRunRequest {
  code: string;
  bars: Bar[];
  config: BacktestConfig;
}

export type SandboxRunResponse = { ok: true; result: ReturnType<typeof runBacktest> } | { ok: false; error: string };

type WorkerLike = {
  onmessage: ((event: MessageEvent<SandboxRunRequest>) => void) | null;
  postMessage: (message: SandboxRunResponse) => void;
};

declare const self: unknown;
declare const importScripts: unknown;

/**
 * `importScripts` exists only inside a worker scope — it is the standard way
 * to tell a worker from a window.
 *
 * The previous guard was `typeof self !== "undefined" && typeof
 * self.postMessage === "function"`, which is TRUE on the browser main thread:
 * there `self === window` and `window.postMessage` is a real function. So any
 * page that imported this module installed `window.onmessage` and would
 * compile and run whatever a `postMessage` handed it — a live bug, not a
 * theoretical one, since the workbench imports this graph.
 */
if (typeof importScripts === "function" && typeof self !== "undefined") {
  const worker = self as unknown as WorkerLike;
  worker.onmessage = (event) => {
    try {
      const { code, bars, config } = event.data;
      const strategy = compileStrategy(code);
      const result = runBacktest(bars, strategy, config);
      worker.postMessage({ ok: true, result });
    } catch (err) {
      worker.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
