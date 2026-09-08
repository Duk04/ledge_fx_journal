import { describe, expect, it } from "vitest";
import { compileStrategy } from "./sandbox";

/**
 * READ THIS BEFORE "FIXING" A FAILURE HERE.
 *
 * Most of the assertions below assert that sandbox escapes SUCCEED. They are
 * not a bug being tracked; they are the executable form of the argument in
 * sandbox.ts's header, and they exist so that nobody can look at the
 * allowlist, conclude it is a security boundary, and move `compileStrategy`
 * back onto the server.
 *
 * If one of these starts failing because someone added a shadow: that shadow
 * closed one route, not the class. Delete it or leave it, but do not conclude
 * the sandbox is now safe for hostile code — and do not celebrate. The real
 * boundary is that this compiler only ever runs in the author's own browser
 * on the author's own code, enforced by
 * `src/lib/actions/server-action-surface.test.ts`.
 */
describe("compileStrategy — the sandbox contains mistakes, not attackers", () => {
  /**
   * Evaluates `expr` inside a compiled strategy and hands back the result.
   *
   * Goes through onBar's return value rather than assigning to a global,
   * because `globalThis` is one of the shadowed names — which is itself a
   * small demonstration that the shadowing does something.
   */
  function evaluate(expr: string): unknown {
    const strategy = compileStrategy(`function onBar(ctx) { return (${expr}); }`);
    return strategy.onBar({} as never) as unknown;
  }

  describe("shadowing does catch honest mistakes", () => {
    it("fetch is undefined, so a stray network call fails loudly", () => {
      expect(evaluate("typeof fetch")).toBe("undefined");
    });

    it("process is undefined", () => {
      expect(evaluate("typeof process")).toBe("undefined");
    });

    it('require is undefined, so `require("fs")` fails instead of working', () => {
      expect(evaluate("typeof require")).toBe("undefined");
    });

    it("document and window are undefined", () => {
      expect(evaluate("typeof document")).toBe("undefined");
      expect(evaluate("typeof window")).toBe("undefined");
    });

    it("direct eval inherits the shadowed scope", () => {
      // Documented precisely because it is counter-intuitive and because the
      // comment in sandbox.ts used to imply this was the hole. It is not:
      // direct eval sees the `process = undefined` parameter.
      expect(evaluate('eval("typeof process")')).toBe("undefined");
    });
  });

  describe("and does NOT stop anyone who is trying", () => {
    it("Object.constructor is the real Function", () => {
      // `Object` has to be in the allowlist for strategies to be writable at
      // all, and every function object's .constructor is Function itself.
      expect(evaluate("typeof Object.constructor")).toBe("function");
      expect(evaluate('Object.constructor("return 1+1")()')).toBe(2);
    });

    it("a bare string literal reaches Function, naming nothing we passed in", () => {
      // The load-bearing case: no allowlist or shadow list can cover this,
      // because it references no identifier at all.
      expect(evaluate('"".constructor.constructor("return 1+1")()')).toBe(2);
    });

    it("indirect eval escapes to global scope", () => {
      expect(evaluate('(0, eval)("1+1")')).toBe(2);
    });

    it("and therefore reaches host globals the allowlist never mentioned", () => {
      // Whatever the host realm has, this gets to. In Node that is `process`;
      // in the browser worker where this legitimately runs, it is the worker
      // scope — which is precisely the blast radius we accept.
      expect(evaluate('typeof Object.constructor("return typeof process")()')).toBe("string");
      expect(evaluate('Object.constructor("return typeof process")()')).toBe("object");
    });
  });

  describe("the parts that are actually contractual", () => {
    it("requires a top-level onBar", () => {
      expect(() => compileStrategy("var x = 1;")).toThrow(/onBar/);
    });

    it("surfaces a syntax error rather than swallowing it", () => {
      expect(() => compileStrategy("function onBar( {")).toThrow();
    });

    it("gives each compiled strategy its own closure for top-level state", () => {
      const src = "var seen = 0; function onBar(ctx) { seen += 1; return seen; }";
      const a = compileStrategy(src);
      const b = compileStrategy(src);
      const ctx = {} as never;
      expect(a.onBar(ctx)).toBe(1);
      expect(a.onBar(ctx)).toBe(2);
      expect(b.onBar(ctx)).toBe(1);
    });

    it("exposes the indicator helpers to strategy code", () => {
      const s = compileStrategy("function onBar(ctx) { return sma([1,2,3], 3); }");
      const out = s.onBar({} as never) as unknown as (number | null)[];
      expect(out[2]).toBe(2);
    });
  });
});
