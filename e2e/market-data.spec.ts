import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// docs/BACKTEST-DATA.md "Downloading from OANDA". The e2e server has no
// token, so this pins the unconfigured state: the Data page explains how to
// get one, and the replay page points there instead of offering a dead form.
test("without an OANDA token, the Data page explains the setup", async ({ page }) => {
  await register(page);
  await page.goto("/backtest/data");
  await expect(page.getByText("Set up automatic downloads")).toBeVisible();
  await expect(page.getByText(/OANDA_API_TOKEN=<token>/)).toBeVisible();
});
