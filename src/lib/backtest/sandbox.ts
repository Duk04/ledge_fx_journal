/**
 * Compiles user-authored strategy code into a callable strategy module.
 *
 * WHERE THIS IS ALLOWED TO RUN: the browser only — a Web Worker owned by the
 * author of the code (see ./worker.ts). Never a server module. This is not a
 * style preference, it is the security boundary, and it is asserted by
 * `src/lib/actions/server-action-surface.test.ts`. `src/lib/backtest/index.ts`
 * deliberately does not re-export this file so that a server module cannot
 * reach the compiler by importing the barrel — which is exactly how it
 * happened before.
 *
 * HONEST THREAT MODEL: this is a guard against MISTAKES, not a security
 * boundary against HOSTILE code. What it buys:
 *   - a typo like `windowe.fetch(...)` or `import fs from "fs"` fails loudly
 *     with a clear error instead of doing something surprising;
 *   - accidentally-pasted code that tries to hit the network, read the DOM,
 *     or read process/env doesn't silently do so;
 *   - a runaway strategy is terminated by the host `terminate()`ing the
 *     worker, without taking the page down.
 *
 * WHAT IT CANNOT BUY, AND WHY NO AMOUNT OF SHADOWING WOULD CHANGE THAT.
 * `new Function` compiles into the same JS realm, and `Function` is reachable
 * without naming it:
 *
 *     Object.constructor("return process")()   // Object is an allowed global,
 *                                              // and .constructor IS Function
 *     "".constructor.constructor("return 1")() // from a bare string literal,
 *                                              // touching nothing we passed in
 *     (0, eval)("...")                         // indirect eval: global scope
 *
 * All three are verified to work. The third is the load-bearing one: a
 * primitive literal reaches `Function` without referencing a single
 * identifier an allowlist or shadow list could cover. So the allowlist below
 * is defence-in-depth against slips, and the ONLY real boundary is that this
 * code runs in the author's own browser on the author's own code.
 *
 * (Note on `eval`: it is absent from SHADOWED_GLOBALS because strict mode
 * forbids binding a parameter named `eval` at all — attempting it is itself a
 * SyntaxError. Direct `eval` does inherit this function's scope, so
 * `eval("typeof process")` correctly yields "undefined"; it is *indirect*
 * eval and the `.constructor` routes above that get out.)
 *
 * Do not add shadows here believing they close the hole, and do not move this
 * back onto the server because "the sandbox looks thorough". It was never
 * built to survive hostile code, and it cannot be.
 */
import { atr, crossOver, crossUnder, ema, highest, lowest, rsi, sma, stdev } from "./indicators";
import type { StrategyModule } from "./types";

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
