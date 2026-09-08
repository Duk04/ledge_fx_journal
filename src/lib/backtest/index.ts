/**
 * Public entry point for the backtest simulation engine.
 *
 * NOTE what is deliberately NOT re-exported here: `./sandbox`, which holds
 * `compileStrategy`. That one `export *` line was how arbitrary strategy code
 * came to be compiled and run inside the Node server process — two server
 * actions imported `compileStrategy` from `@/lib/backtest` without ever
 * naming the sandbox, so nothing about their import looked dangerous.
 *
 * Anything that legitimately needs the compiler runs in the browser and
 * imports `./sandbox` (or `./worker`) by path, which makes the dependency
 * visible in review. `src/lib/actions/server-action-surface.test.ts` asserts
 * no server action reaches it.
 *
 * Server-side source validation that does NOT execute anything lives in
 * `./strategy-source`.
 */
export * from "./types";
export * from "./fill";
export * from "./indicators";
export * from "./runner";
export * from "./examples";
export * from "./strategy-source";
