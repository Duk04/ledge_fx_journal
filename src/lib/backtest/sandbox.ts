/**
 * Compiles and runs user-authored strategy code.
 *
 * HONEST THREAT MODEL (read this before touching anything below): this is a
 * guard against MISTAKES, not a security boundary against HOSTILE code. This
 * is a single-user app running its own owner's strategy scripts — the same
 * trust level as running a script the owner wrote in their own editor. What
 * this file actually buys:
 *   - a typo like `windowe.fetch(...)` or `import fs from "fs"` fails loudly
 *     with a clear error instead of doing something surprising;
 *   - accidentally-pasted code that tries to hit the network, read the DOM,
 *     or read process/env doesn't silently do so;
 *   - one runaway strategy can be terminated (via the Worker it runs in)
 *     without taking the rest of the app down with it.
 * What it does NOT buy: `new Function` still runs in the same JS realm and
 * `"use strict"` does not remove access to `Array`, `Object`, `Date`,
 * `Promise`, `Symbol`, dynamic `import()`, or any other unlisted global we
 * did not think to shadow. A user determined to defeat this from their own
 * strategy code can. That is fine, because they would only be attacking
 * their own browser tab with their own strategy code — there is no other
 * user's data anywhere in reach. Do not repurpose this to run someone else's
 * code; it was never built to survive that.
 */
import { atr, crossOver, crossUnder, ema, highest, lowest, rsi, sma, stdev } from "./indicators";
import { runBacktest } from "./runner";
import type { Bar, BacktestConfig, StrategyModule } from "./types";

/**
 * Everything strategy code is allowed to see, passed in as named parameters
 * to `new Function` (see compileStrategy). An identifier not in this list,
 * and not explicitly shadowed below, falls through to whatever the JS realm
 * provides — see the module doc above for why that is an accepted, DOCUMENTED
 * gap rather than a security hole we pretend not to have.
 */
const ALLOWED_GLOBALS: Record<string, unknown> = {
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  JSON,
  isNaN,
  isFinite,
  parseFloat,
  parseInt,
  sma,
  ema,
  rsi,
  atr,
  stdev,
  highest,
  lowest,
  crossOver,
  crossUnder,
};

/**
 * Names explicitly shadowed with `undefined` so a strategy touching one of
 * these gets `undefined is not a function` / `Cannot read properties of
 * undefined` instead of quietly succeeding. This list is illustrative
 * defense-in-depth, not exhaustive — see the module doc's honest threat
 * model. `eval` and `Function` are included so code can't reopen the same
 * hole `compileStrategy` itself uses to get here.
 */
const SHADOWED_GLOBALS = [
  "fetch",
  "window",
  "self",
  "globalThis",
  "global",
  "process",
  // NOT "eval": strict mode (which the compiled body opts into) forbids
  // binding an identifier named `eval` at all — attempting to shadow it as
  // a parameter is itself a SyntaxError. `eval` therefore stays reachable
  // as the real global. That is consistent with this module's threat
  // model: it was never meant to stop code from doing what it wants to its
  // own sandbox, only to catch mistakes — see the module doc.
  "Function",
  "require",
  "module",
  "exports",
  "importScripts",
  "postMessage",
  "XMLHttpRequest",
  "WebSocket",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
] as const;

const GLOBAL_NAMES = Object.keys(ALLOWED_GLOBALS);
const GLOBAL_VALUES = GLOBAL_NAMES.map((name) => ALLOWED_GLOBALS[name]);
const SHADOW_VALUES = SHADOWED_GLOBALS.map(() => undefined);

/**
 * Compiles a strategy source string into a `StrategyModule`.
 *
 * The code must declare a top-level `function onBar(ctx) { ... }` and,
 * optionally, `function init(ctx) { ... }` — plain function declarations,
 * not exports (there is no module system inside the sandbox: no `import`,
 * no `require`, no `export`). Anything else the code declares at top level
 * (helper functions, `var` state that should persist across bars — see the
 * London breakout example) is fine and stays private to that strategy
 * instance, because `new Function` gives every call its own closure.
 *
 * Throws synchronously if the code fails to parse, throws while
 * initializing, or never defines `onBar`.
 */
export function compileStrategy(code: string): StrategyModule {
  const body = `
"use strict";
${code}
if (typeof onBar !== "function") {
  throw new Error("Strategy must define a top-level function onBar(ctx).");
}
return { init: typeof init === "function" ? init : undefined, onBar: onBar };
`;
  const factory = new Function(...GLOBAL_NAMES, ...SHADOWED_GLOBALS, body);
  return factory(...GLOBAL_VALUES, ...SHADOW_VALUES) as StrategyModule;
}

/** Message a host page sends into the worker to run one backtest. */
export interface SandboxRunRequest {
  code: string;
  bars: Bar[];
  config: BacktestConfig;
}

export type SandboxRunResponse =
  | { ok: true; result: ReturnType<typeof runBacktest> }
  | { ok: false; error: string };

/**
 * Worker-side entry point. When this module is the script loaded by `new
 * Worker(...)`, it wires up a message handler that compiles the posted
 * strategy code and runs the backtest, so a runaway or crashing strategy
 * only takes down the worker (terminable from the outside) rather than the
 * page. Guarded so importing this module in Node (tests, SSR, or the
 * `compileStrategy`/example-strategy exports used directly) never touches
 * `self`.
 */
type WorkerLike = {
  onmessage: ((event: MessageEvent<SandboxRunRequest>) => void) | null;
  postMessage: (message: SandboxRunResponse) => void;
};

declare const self: unknown;

if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function") {
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

// ---------------------------------------------------------------------------
// Example strategies — the templates the UI offers. Each is real, working
// code exercised in this module's throwaway verification script against
// synthetic bars, not illustrative pseudocode.
// ---------------------------------------------------------------------------

export interface ExampleStrategy {
  name: string;
  description: string;
  params: Record<string, number | string | boolean>;
  code: string;
}

export const EMA_CROSS_STRATEGY: ExampleStrategy = {
  name: "EMA Cross",
  description: "Goes long when the fast EMA crosses above the slow EMA, short when it crosses below, with an ATR stop so every trade has an R multiple.",
  params: { fastPeriod: 10, slowPeriod: 30, atrPeriod: 14, atrMultiplier: 2, lots: 1 },
  code: `
function onBar(ctx) {
  var fastPeriod = Number(ctx.params.fastPeriod);
  var slowPeriod = Number(ctx.params.slowPeriod);
  var atrPeriod = Number(ctx.params.atrPeriod);
  var atrMultiplier = Number(ctx.params.atrMultiplier);
  var lots = Number(ctx.params.lots);
  if (ctx.bars.length <= slowPeriod + atrPeriod) return;

  var closes = ctx.bars.map(function (b) { return b.close; });
  var highs = ctx.bars.map(function (b) { return b.high; });
  var lows = ctx.bars.map(function (b) { return b.low; });

  var fast = ema(closes, fastPeriod);
  var slow = ema(closes, slowPeriod);
  var up = crossOver(fast, slow);
  var down = crossUnder(fast, slow);
  var atrValues = atr(highs, lows, closes, atrPeriod);
  var i = ctx.i;

  // Without a stop there is no risk to divide by, so every trade would report
  // a null R and the whole R-based half of the report would go blank. An ATR
  // stop also sizes the risk to how much this market is actually moving.
  var stopDistance = atrValues[i] === null ? null : atrValues[i] * atrMultiplier;
  if (stopDistance === null) return;

  if (!ctx.position) {
    if (up[i]) {
      ctx.buy({
        lots: lots,
        stopLoss: ctx.bar.close - stopDistance,
        takeProfit: ctx.bar.close + stopDistance * 2,
        reason: "fast EMA crossed above slow EMA"
      });
    } else if (down[i]) {
      ctx.sell({
        lots: lots,
        stopLoss: ctx.bar.close + stopDistance,
        takeProfit: ctx.bar.close - stopDistance * 2,
        reason: "fast EMA crossed below slow EMA"
      });
    }
    return;
  }

  if (ctx.position.side === "LONG" && down[i]) {
    ctx.close("fast EMA crossed back below slow EMA");
  } else if (ctx.position.side === "SHORT" && up[i]) {
    ctx.close("fast EMA crossed back above slow EMA");
  }
}
`.trim(),
};

export const RSI_MEAN_REVERSION_STRATEGY: ExampleStrategy = {
  name: "RSI Mean Reversion",
  description: "Buys oversold / sells overbought RSI extremes with an ATR-based stop, and exits back at the RSI midline.",
  params: { rsiPeriod: 14, oversold: 30, overbought: 70, atrPeriod: 14, atrMultiplier: 2, lots: 1 },
  code: `
function onBar(ctx) {
  var rsiPeriod = Number(ctx.params.rsiPeriod);
  var oversold = Number(ctx.params.oversold);
  var overbought = Number(ctx.params.overbought);
  var atrPeriod = Number(ctx.params.atrPeriod);
  var atrMultiplier = Number(ctx.params.atrMultiplier);
  var lots = Number(ctx.params.lots);
  if (ctx.bars.length <= Math.max(rsiPeriod, atrPeriod)) return;

  var closes = ctx.bars.map(function (b) { return b.close; });
  var highs = ctx.bars.map(function (b) { return b.high; });
  var lows = ctx.bars.map(function (b) { return b.low; });
  var rsiSeries = rsi(closes, rsiPeriod);
  var atrSeries = atr(highs, lows, closes, atrPeriod);
  var i = ctx.i;
  var currentRsi = rsiSeries[i];
  var currentAtr = atrSeries[i];
  if (currentRsi === null || currentAtr === null) return;

  if (!ctx.position) {
    if (currentRsi < oversold) {
      ctx.buy({
        lots: lots,
        stopLoss: ctx.bar.close - currentAtr * atrMultiplier,
        reason: "RSI oversold (" + currentRsi.toFixed(1) + ")",
      });
    } else if (currentRsi > overbought) {
      ctx.sell({
        lots: lots,
        stopLoss: ctx.bar.close + currentAtr * atrMultiplier,
        reason: "RSI overbought (" + currentRsi.toFixed(1) + ")",
      });
    }
    return;
  }

  if (ctx.position.side === "LONG" && currentRsi >= 50) {
    ctx.close("RSI reverted to midline");
  } else if (ctx.position.side === "SHORT" && currentRsi <= 50) {
    ctx.close("RSI reverted to midline");
  }
}
`.trim(),
};

export const LONDON_BREAKOUT_STRATEGY: ExampleStrategy = {
  name: "London Breakout",
  description: "Tracks the high/low of the opening minutes of the London session, then trades a breakout of that range for the rest of the session.",
  params: { rangeMinutes: 60, stopBufferPips: 5, lots: 1 },
  code: `
var rangeHigh = null;
var rangeLow = null;
var sessionDayKey = null;
var tradedToday = false;

function dayKey(ts) {
  var d = new Date(ts);
  return d.getUTCFullYear() + "-" + d.getUTCMonth() + "-" + d.getUTCDate();
}

function onBar(ctx) {
  var rangeMinutes = Number(ctx.params.rangeMinutes);
  var stopBufferPips = Number(ctx.params.stopBufferPips);
  var lots = Number(ctx.params.lots);

  var d = new Date(ctx.bar.ts);
  var hour = d.getUTCHours();
  var minute = d.getUTCMinutes();
  var key = dayKey(ctx.bar.ts);

  if (key !== sessionDayKey) {
    sessionDayKey = key;
    rangeHigh = null;
    rangeLow = null;
    tradedToday = false;
  }

  // London opens 07:00 UTC.
  var minutesSinceOpen = (hour - 7) * 60 + minute;

  if (hour >= 16) {
    if (ctx.position) ctx.close("London session ended");
    return;
  }

  var inRangeWindow = minutesSinceOpen >= 0 && minutesSinceOpen < rangeMinutes;
  if (inRangeWindow) {
    rangeHigh = rangeHigh === null ? ctx.bar.high : Math.max(rangeHigh, ctx.bar.high);
    rangeLow = rangeLow === null ? ctx.bar.low : Math.min(rangeLow, ctx.bar.low);
    return;
  }

  var inTradingWindow = minutesSinceOpen >= rangeMinutes;
  if (!inTradingWindow || rangeHigh === null || rangeLow === null || tradedToday || ctx.position) return;

  var pip = ctx.instrument.pipSize;
  var span = rangeHigh - rangeLow;

  if (ctx.bar.close > rangeHigh) {
    tradedToday = true;
    ctx.buy({
      lots: lots,
      stopLoss: rangeLow - stopBufferPips * pip,
      takeProfit: ctx.bar.close + span,
      reason: "broke above the London opening range",
    });
  } else if (ctx.bar.close < rangeLow) {
    tradedToday = true;
    ctx.sell({
      lots: lots,
      stopLoss: rangeHigh + stopBufferPips * pip,
      takeProfit: ctx.bar.close - span,
      reason: "broke below the London opening range",
    });
  }
}
`.trim(),
};

export const EXAMPLE_STRATEGIES: ExampleStrategy[] = [
  EMA_CROSS_STRATEGY,
  RSI_MEAN_REVERSION_STRATEGY,
  LONDON_BREAKOUT_STRATEGY,
];
