import { expect, test } from "@playwright/test";
import { fact, register } from "./helpers";

// Flow 2 of docs/TESTING.md — "the whole app's thesis in one test": create an
// account, log a closed trade, and check the numbers the app computed.
test("log a closed trade and see computed P&L, R and session", async ({ page }) => {
  await register(page);

  // Create a second account and make it the active one.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "New account" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Label").fill("E2E Live");
  await dialog.getByLabel("Starting balance").fill("10000");
  await dialog.getByRole("button", { name: "Create account" }).click();
  await expect(dialog).toBeHidden();

  // The nearest ancestor of the card's heading that also holds its menu.
  const card = page
    .getByRole("heading", { name: "E2E Live" })
    .locator("xpath=ancestor::*[.//button[@aria-label='Account actions']][1]");
  await card.getByRole("button", { name: "Account actions" }).click();
  await page.getByRole("menuitem", { name: "Set as active" }).click();
  await expect(page.getByRole("heading", { name: "E2E Live Active" })).toBeVisible();

  // EURUSD long, 1 lot: entry 1.10000, stop 1.09900 (10 pips risk), exit
  // 1.10200 (+20 pips). Opened 21:30 Ulaanbaatar = 13:30 UTC on a Wednesday,
  // inside the London/New York overlap.
  await page.goto("/trades/new");
  await page.getByLabel("Symbol").click();
  await page.getByRole("option", { name: /^EURUSD/ }).click();
  await page.getByRole("radio", { name: "Closed" }).click();
  await page.getByLabel("Volume (lots)").fill("1");
  await page.getByLabel("Entry price").fill("1.10000");
  await page.getByLabel("Stop loss").fill("1.09900");
  await page.getByLabel("Exit price").fill("1.10200");
  await page.getByLabel("Opened at").fill("2026-03-04T21:30");
  await page.getByLabel("Closed at").fill("2026-03-04T23:00");
  await page.getByRole("button", { name: /Log trade/ }).click();

  await expect(page).toHaveURL(/\/trades\/(?!new$)[^/]+$/);
  await expect(fact(page, "Net P&L")).toContainText("$200.00");
  await expect(fact(page, "R multiple")).toContainText("+2.00R");
  await expect(fact(page, "Pips")).toContainText("20");
  await expect(fact(page, "Session")).toHaveText("OV");
  await expect(fact(page, "Held")).toHaveText("1h 30m");
});
