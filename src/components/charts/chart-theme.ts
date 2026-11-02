/**
 * Colours for the canvas charts (lightweight-charts). A `<canvas>` cannot
 * consume Tailwind classes or `var(--token)` strings the way the rest of the
 * app's chrome does — the library wants resolved colour strings — so these
 * are read off `document.documentElement` with `getComputedStyle`, and the
 * charts follow the real tokens in globals.css and the light/dark swap.
 *
 * The literals are a last resort for a stylesheet that has not loaded, not a
 * second palette; they are roughly the dark theme and are allowed to drift.
 * Shared by the replay chart and the trade chart, which used to import this
 * from inside the backtest feature.
 */
export function readTokens() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    panel: v("--panel") || "#14181e",
    ink: v("--ink") || "#e9ecf1",
    ink3: v("--ink-3") || "#6b7480",
    line: v("--line") || "#262c34",
    profit: v("--profit") || "#35c08f",
    loss: v("--loss") || "#c0402a",
    brand: v("--brand") || "#6c86f5",
    warn: v("--warn") || "#e0a93b",
  };
}

/**
 * Calls `apply` whenever the theme changes: an explicit `data-theme` flip on
 * <html> (the toggle), or — in "system" mode, with no attribute — the OS
 * preference changing. Returns the unsubscribe, for an effect's cleanup.
 */
export function onThemeChange(apply: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  media.addEventListener("change", apply);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", apply);
  };
}
