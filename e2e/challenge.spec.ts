import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// Prop-firm rules: set them on an account, see the challenge panel; and the
// Periods tab renders its three reports.
test("challenge rules on an account show a challenge panel on the dashboard", async ({ page }) => {
  await register(page);
  await expect(page.getByRole("heading", { name: "Challenge" })).toBeHidden();

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Account actions" }).first().click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Daily loss limit").fill("5");
  await dialog.getByLabel("Profit target").fill("10");
  await dialog.getByLabel("Max drawdown").fill("10");
  await dialog.getByRole("radio", { name: "Highest balance" }).click();
  await dialog.getByLabel("Minimum trading days").fill("4");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Challenge" })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Profit target" })).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("meter", { name: /Max drawdown · trailing/ })).toBeVisible();
  await expect(page.getByText("0 of 4")).toBeVisible();
});

test("the Periods tab shows the month grid, the comparison and exit efficiency", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("duk@example.com");
  await page.locator("#password").fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/analytics?range=90d");
  await page.getByRole("tab", { name: "Periods" }).click();
  await expect(page.getByText("By month")).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026" })).toBeVisible();
  await expect(page.getByText("Against the previous period")).toBeVisible();
  await expect(page.getByText("Exit efficiency")).toBeVisible();
});
