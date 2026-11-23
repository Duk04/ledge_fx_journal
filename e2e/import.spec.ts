import { expect, test } from "@playwright/test";
import { MT4_DETAILED } from "../test/fixtures/statements";
import { register } from "./helpers";

// A real (1×1) PNG: the upload route sniffs the bytes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// The statement import end to end: preview writes nothing, import writes the
// trades and lands on them, a screenshot and a note go on from the list,
// re-importing the same file finds nothing new, and undo removes it.
test("import an MT4 statement, add a screenshot from the list, then undo it", async ({ page }) => {
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

  // Straight to the trades this import created, and only those.
  await expect(page).toHaveURL(/\/trades\?import=[0-9a-f-]{36}$/);
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);

  // One dialog walks them: a chart and a note on the first, then the next.
  await rows.first().getByRole("button", { name: "Add a screenshot" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("1 of 3")).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: PNG });
  await expect(dialog.locator('img[src^="/api/attachments/"]')).toHaveCount(1);
  await dialog.getByLabel("Note", { exact: true }).fill("Late entry, held to target.");
  await dialog.getByRole("button", { name: "Next trade" }).click();
  await expect(dialog.getByText("2 of 3")).toBeVisible();
  await expect(dialog.locator('img[src^="/api/attachments/"]')).toHaveCount(0);
  await expect(dialog.getByLabel("Note", { exact: true })).toHaveValue("");

  // Back again: what was just added is still there, not the page's stale copy.
  await dialog.getByRole("button", { name: "Previous trade" }).click();
  await expect(dialog.locator('img[src^="/api/attachments/"]')).toHaveCount(1);
  await expect(dialog.getByLabel("Note", { exact: true })).toHaveValue("Late entry, held to target.");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(rows.first().getByRole("button", { name: "1 screenshot" })).toBeVisible();

  // "No screenshot" is what is left to do.
  await page.getByRole("button", { name: "No screenshot" }).click();
  await expect(page).toHaveURL(/shots=none/);
  await expect(rows).toHaveCount(2);

  // The note reached the trade itself, and outlives a reload.
  await page.getByRole("button", { name: "No screenshot" }).click();
  await expect(rows).toHaveCount(3);
  const tradeHref = await rows.first().getByRole("link").first().getAttribute("href");
  await page.goto(tradeHref!);
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue("Late entry, held to target.");

  await page.goto("/trades?range=all");
  for (const symbol of ["EURUSD", "EURJPY", "XAUUSD"]) {
    await expect(page.getByRole("cell", { name: new RegExp(symbol) }).first()).toBeVisible();
  }

  // Same file again: nothing new to write. Wait for hydration first — a file
  // chosen before React attaches its onChange is silently dropped.
  await page.goto("/trades/import");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("statement-file").setInputFiles(upload);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("3 already imported")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import 0 trades/ })).toBeDisabled();

  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByText(/Removed 3 trade/)).toBeVisible();
  await page.goto("/trades?range=all");
  await expect(page.getByText("0 trades in view")).toBeVisible();
});
