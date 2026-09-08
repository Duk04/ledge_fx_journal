/**
 * Server-side validation of strategy source, without running it.
 *
 * WHY THIS EXISTS SEPARATELY FROM `compileStrategy`
 *
 * Saving a strategy should tell the author immediately that they typed
 * `fucntion onBar` — waiting until a run is submitted minutes later is a poor
 * experience. The obvious way to get that is to call `compileStrategy` at save
 * time, which is what this app used to do. That is remote code execution: this
 * app has open registration, and `compileStrategy` ends in `factory(...)`,
 * which *runs* the author's top-level code inside the Node server process.
 *
 * The distinction this module rests on: `new Function(body)` **compiles**
 * `body` and hands back a function. It does not call it. A syntax error throws
 * here; a `process.exit()` at the top level of `body` does not run, because
 * nothing invokes the result. So the server can parse untrusted source safely,
 * as long as it never invokes what it got back — which is the one thing the
 * code below is careful not to do.
 *
 * What moves to the client as a result: the "must define a top-level onBar"
 * check, which genuinely cannot be made without executing the source (the
 * declaration only exists once the body has run). The workbench compiles in a
 * Web Worker before submitting, so the author still learns about it at edit
 * time — see `use-strategy-runner.ts`.
 *
 * The length cap is the other half of the safety story. Compilation is cheap
 * per byte but not free, and an uncapped `code` field makes a parser a CPU
 * amplifier. The schema had `.min(1)` and no maximum.
 */

/** Roughly 500 lines of dense JS. The three bundled templates are all under
 * 3 KB, so this is generous rather than tight — it exists to bound the
 * parser's input, not to police style. */
export const MAX_STRATEGY_CODE_CHARS = 20_000;

/**
 * Returns null when `code` parses as a valid function body, or a
 * human-readable message when it does not.
 *
 * NEVER invoke the value `new Function` returns here. Compiling is safe;
 * calling is arbitrary code execution on the server.
 */
export function checkStrategySyntax(code: string): string | null {
  if (code.length > MAX_STRATEGY_CODE_CHARS) {
    return `Strategy code is ${code.length.toLocaleString()} characters, over the ${MAX_STRATEGY_CODE_CHARS.toLocaleString()}-character limit.`;
  }

  try {
    // `"use strict"` matches the prologue `compileStrategy` prepends, so a
    // strict-mode-only error (assigning to an undeclared variable, say) is
    // caught here rather than surfacing later in the worker.
    //
    // The result is deliberately discarded. See the module header.
    new Function(`"use strict";\n${code}`);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
