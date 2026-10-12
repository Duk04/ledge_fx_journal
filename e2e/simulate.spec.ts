import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("what-if caps losses and Monte Carlo reports on the demo account", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Simulate" }).click();
  await expect(page.getByRole("heading", { name: "Simulate" })).toBeVisible();

  await page.getByRole("radio", { name: "−1R" }).click();
  await expect(page.getByText(/loss\(es\) capped/)).toBeVisible();
  await page.getByRole("button", { name: "Fri", pressed: false }).click();
  await expect(page.getByRole("button", { name: "Fri", pressed: true })).toBeVisible();
  await expect(page.getByText(/trade\(s\) left out/)).toBeVisible();

  await expect(page.getByText("Median outcome")).toBeVisible();
  await expect(page.getByText(/Chance of a 20% drawdown/)).toBeVisible();
});

test("the position-size calculator sizes to the risk budget", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Position size" }).click();
  await page.getByLabel("Risk", { exact: true }).fill("1");
  await page.getByLabel("Balance").fill("10000");
  await page.getByLabel("Entry price").fill("1.10000");
  await page.getByLabel("Stop loss").fill("1.09800");
  // 1% of 10,000 = $100 over a 20-pip EURUSD stop = 0.50 lots.
  await expect(page.getByTestId("lots")).toHaveText("0.50");
  await expect(page.getByText("20 pips")).toBeVisible();
});
