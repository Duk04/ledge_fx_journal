import { describe, expect, it } from "vitest";
import { MAX_STRATEGY_CODE_CHARS, checkStrategySyntax } from "./strategy-source";

describe("checkStrategySyntax", () => {
  describe("does not execute what it parses", () => {
    /**
     * The whole reason this function exists instead of `compileStrategy`.
     * If any of these fail, the server is running strategy code again.
     */
    it("does not run a top-level throw", () => {
      expect(() => checkStrategySyntax('throw new Error("executed")')).not.toThrow();
      expect(checkStrategySyntax('throw new Error("executed")')).toBeNull();
    });

    it("does not run a top-level side effect", () => {
      const key = "__strategy_source_side_effect__";
      const g = globalThis as Record<string, unknown>;
      delete g[key];
      expect(checkStrategySyntax(`globalThis[${JSON.stringify(key)}] = true;`)).toBeNull();
      expect(g[key]).toBeUndefined();
    });

    it("does not run an escape that would work under compileStrategy", () => {
      const key = "__strategy_source_escape__";
      const g = globalThis as Record<string, unknown>;
      delete g[key];
      expect(checkStrategySyntax(`Object.constructor("globalThis['${key}'] = true")();`)).toBeNull();
      expect(g[key]).toBeUndefined();
    });

    it("does not run an infinite loop", () => {
      // Compiling `while (true) {}` is instant; calling it never returns.
      // A timeout failure here means execution crept back in.
      expect(checkStrategySyntax("while (true) {}")).toBeNull();
    }, 1000);
  });

  describe("still reports the mistakes it is there to catch", () => {
    it("accepts a well-formed strategy", () => {
      expect(checkStrategySyntax("function onBar(ctx) { return 1; }")).toBeNull();
    });

    it("rejects an unclosed brace", () => {
      expect(checkStrategySyntax("function onBar( {")).toMatch(/./);
    });

    it("rejects a stray token", () => {
      expect(checkStrategySyntax("function onBar(ctx) {} ???")).toMatch(/./);
    });

    it("rejects a strict-mode-only error", () => {
      // `delete` on a plain identifier is legal in sloppy mode, a SyntaxError
      // under "use strict" — which is the prologue compileStrategy prepends,
      // so catching it here matches what the worker would do.
      expect(checkStrategySyntax("var x = 1; delete x;")).toMatch(/./);
    });

    it("does not treat a return outside a function as an error", () => {
      // The source becomes a function body, so a bare `return` is valid —
      // matching compileStrategy, which wraps the same way.
      expect(checkStrategySyntax("return 1;")).toBeNull();
    });
  });

  describe("length cap", () => {
    it("accepts code at exactly the limit", () => {
      expect(checkStrategySyntax("//".padEnd(MAX_STRATEGY_CODE_CHARS, "x"))).toBeNull();
    });

    it("rejects code one character over, without parsing it", () => {
      const tooLong = "//".padEnd(MAX_STRATEGY_CODE_CHARS + 1, "x");
      expect(checkStrategySyntax(tooLong)).toMatch(/limit/);
    });

    it("reports the limit and the actual size", () => {
      const msg = checkStrategySyntax("x".repeat(MAX_STRATEGY_CODE_CHARS + 50));
      expect(msg).toContain(MAX_STRATEGY_CODE_CHARS.toLocaleString());
      expect(msg).toContain((MAX_STRATEGY_CODE_CHARS + 50).toLocaleString());
    });
  });
});
