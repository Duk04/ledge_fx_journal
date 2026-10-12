import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// docs/JOURNAL.md "Restore" — the round trip a person would do: export, then
// bring the file back. The restored account appears beside the original.
test("a JSON export restores as a new account with its trade", async ({ page }) => {
  await register(page);

  await page.goto("/trades/new");
  await page.getByLabel("Symbol").click();
  await page.getByRole("option", { name: /^EURUSD/ }).click();
  await page.getByLabel("Volume (lots)").fill("1");
  await page.getByLabel("Entry price").fill("1.10000");
  await page.getByRole("button", { name: /Log trade/ }).click();
  await expect(page).toHaveURL(/\/trades\/[^/]+$/);

  const res = await page.request.get("/api/export/data");
  expect(res.ok()).toBe(true);
  const file = join(tmpdir(), `ledger-export-${Date.now()}.json`);
  writeFileSync(file, await res.body());

  await page.goto("/settings?tab=data");
  await page.getByTestId("restore-file").setInputFiles(file);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByTestId("restore-result")).toContainText("1 account");
  await expect(page.getByTestId("restore-result")).toContainText("1 trade");

  await page.goto("/accounts");
  await expect(page.getByRole("heading", { name: "Main (restored)" })).toBeVisible();
});
