import { expect, test, type Page } from "@playwright/test";
import { insertCandles, register } from "./helpers";

// docs/BACKTEST.md "Replay chart tools": drawings, the position tool, the
// second (higher-timeframe) chart and the keyboard.

async function startReplay(page: Page) {
  await insertCandles("EURUSD", "M15", "2026-03-02T00:00:00Z", 300, 15);
  await register(page);
  await page.goto("/backtest/replay");
  await page.getByLabel("Symbol").click();
  await page.getByRole("option", { name: "EURUSD" }).click();
  await page.getByLabel("Timeframe").click();
  await page.getByRole("option", { name: "M15", exact: true }).click();
  await page.getByLabel("From").fill("2026-03-02");
  await page.getByLabel("To").fill("2026-03-05");
  await page.getByRole("button", { name: "Start replay" }).click();
  await expect(page).toHaveURL(/\/backtest\/replay\?runId=/);
  await expect(page.getByRole("toolbar", { name: "Chart tools" })).toBeVisible();
}

function drawingsStored(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("ledger:replay-drawings:"));
    return key ? (JSON.parse(localStorage.getItem(key)!) as { kind: string }[]) : [];
  });
}

test("draw on the chart, plan with the position tool, step by keyboard, open a second chart", async ({ page }) => {
  await startReplay(page);
  const chart = page.locator(".tv-lightweight-charts").first();
  const box = (await chart.boundingBox())!;

  // Trend line: T, then two clicks.
  await page.keyboard.press("t");
  await expect(page.getByRole("button", { name: "Trend line" })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
  // Horizontal line: one click.
  await page.keyboard.press("h");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => drawingsStored(page).then((d) => d.map((x) => x.kind))).toEqual(["trend", "hline"]);

  // Undo removes the last one; drawings survive a reload.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => drawingsStored(page).then((d) => d.length)).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Undo last drawing" })).toBeEnabled();

  // Position tool: Shift+B plans a long; lots come from the risk %.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+B");
  await expect(page.getByRole("button", { name: "Long position" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Risk")).toHaveValue("1");
  const lots = page.getByLabel("Lots");
  await expect(lots).not.toHaveValue("");
  await expect(lots).toHaveAttribute("readonly", "");
  await page.screenshot({ path: test.info().outputPath("replay-tools.png") });

  // B places it; the next bar fills it.
  await page.keyboard.press("b");
  await expect(page.getByText(/^Pending LONG/)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Floating P&L")).toBeVisible();

  // Shift+→ steps ten bars at once.
  const slider = page.getByRole("slider", { name: "Bar position" });
  const before = Number(await slider.inputValue());
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => Number(await slider.inputValue())).toBe(before + 10);

  // M opens the higher-timeframe chart next to it.
  await page.keyboard.press("m");
  await expect(page.getByText("EURUSD · M30")).toBeVisible();
  await expect(page.locator(".tv-lightweight-charts")).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath("replay-htf.png") });
});
