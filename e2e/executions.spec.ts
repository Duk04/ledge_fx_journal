import { expect, test } from "@playwright/test";
import { fact, insertOpenPriceTrade, register } from "./helpers";

// Scaling out: log an open 2-lot trade, close 1 lot (it stays open), then the
// rest (it closes, with the P&L of both exits).
test("partial close keeps the trade open; closing the rest computes P&L from both exits", async ({ page }) => {
  const { email } = await register(page);

  // Fills belong to price-mode trades, which come from statement imports now
  // that the form logs in R — so this one is inserted as an import would be.
  const id = await insertOpenPriceTrade(email, {
    symbol: "EURUSD",
    direction: "LONG",
    lots: "2",
    entry: "1.10000",
    stop: "1.09900",
    openedAt: "2026-03-04T09:00:00Z",
  });
  await page.goto(`/trades/${id}`);

  const closeOnce = async (lots: string | null, price: string, at: string) => {
    await page.getByRole("button", { name: "Close trade" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Exit price").fill(price);
    if (lots) await dialog.getByLabel("Lots to close").fill(lots);
    await dialog.getByLabel("Closed at").fill(at);
    await dialog.getByRole("button", { name: "Close trade" }).click();
    await expect(dialog).toBeHidden();
  };

  await closeOnce("1", "1.10100", "2026-03-04T18:00");
  await expect(page.getByText("1 lots open")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close trade" })).toBeVisible(); // still open

  await closeOnce(null, "1.10300", "2026-03-04T19:00");
  await expect(page.getByText("flat")).toBeVisible();
  // +10 pips on 1 lot ($100) + 30 pips on 1 lot ($300) = $400; risk 10 pips × 2 lots = $200.
  await expect(fact(page, "Net P&L")).toContainText("$400.00");
  await expect(fact(page, "R multiple")).toContainText("+2.00R");
  await expect(page.getByRole("button", { name: "Close trade" })).toBeHidden();
});
