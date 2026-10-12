import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import mn from "../../messages/mn.json";
import { localeFromAcceptLanguage } from "./config";

describe("localeFromAcceptLanguage", () => {
  it("picks the first supported base language", () => {
    expect(localeFromAcceptLanguage("mn-MN,mn;q=0.9,en;q=0.8")).toBe("mn");
    expect(localeFromAcceptLanguage("de-DE,en-US;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("fr")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });
});

/** Every key path in a nested message object, e.g. "nav.overview". */
function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("message catalogues", () => {
  // A key missing from one language renders as the raw key path to that
  // user — this is the test that stops it shipping.
  it("English and Mongolian have exactly the same keys", () => {
    expect(keys(mn).sort()).toEqual(keys(en).sort());
  });

  it("no message is empty", () => {
    for (const [name, cat] of [
      ["en", en],
      ["mn", mn],
    ] as const) {
      const flat = keys(cat);
      for (const k of flat) {
        const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], cat);
        expect(typeof v === "string" && v.trim().length > 0, `${name}:${k}`).toBe(true);
      }
    }
  });
});
