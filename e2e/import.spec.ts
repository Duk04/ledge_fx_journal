import { expect, test } from "@playwright/test";
import { MT4_DETAILED } from "../src/lib/statements/fixtures";
import { register } from "./helpers";

// The statement import end to end: preview writes nothing, import writes the
// trades, re-importing the same file finds nothing new, and undo removes it.
test("import an MT4 statement, then undo it", async ({ page }) => {
  await register(page);

  await page.goto("/trades");
  await page.getByRole("link", { name: "Import statement" }).click();
  await expect(page).toHaveURL("/trades/import");

  const upload = { name: "DetailedStatement.htm", mimeType: "text/html", buffer: Buffer.from(MT4_DETAILED) };
  await page.getByTestId("statement-file").setInputFiles(upload);
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.getByText("3 new")).toBeVisible();
  await expect(page.getByText("1 deposits/withdrawals")).toBeVisible();
  await expect(page.getByText("rate from broker")).toBeVisible(); // the EURJPY cross

  await page.getByRole("button", { name: /Import 3 trades and 1 cash movement/ }).click();
  await expect(page.getByText("Imported 3 trades")).toBeVisible();

  await page.goto("/trades?range=all");
  for (const symbol of ["EURUSD", "EURJPY", "XAUUSD"]) {
    await expect(page.getByRole("cell", { name: new RegExp(symbol) }).first()).toBeVisible();
  }

  // Same file again: nothing new to write.
  await page.goto("/trades/import");
  await page.getByTestId("statement-file").setInputFiles(upload);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("3 already imported")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import 0 trades/ })).toBeDisabled();

  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByText(/Removed 3 trade/)).toBeVisible();
  await page.goto("/trades?range=all");
  await expect(page.getByText("0 trades in view")).toBeVisible();
});
