import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// docs/TRADES.md "Screenshots". A real (1×1) PNG: the upload route sniffs the
// bytes, so a renamed text file would be refused — as it should be.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("screenshots picked while logging a trade upload with it, and more can be added on the trade", async ({
  page,
}) => {
  await register(page);

  await page.goto("/trades/new");
  await page.getByLabel("Symbol").click();
  await page.getByRole("option", { name: /^EURUSD/ }).click();
  await page.getByLabel("Volume (lots)").fill("1");
  await page.getByLabel("Entry price").fill("1.10000");

  await page.getByTestId("trade-screenshots-input").setInputFiles([
    { name: "setup.png", mimeType: "image/png", buffer: PNG },
    { name: "notes.png", mimeType: "image/png", buffer: PNG },
  ]);
  const pending = page.getByRole("list", { name: "Screenshots" });
  await expect(pending.getByRole("listitem")).toHaveCount(2);
  // Second one is the result, not the setup; then change our mind about one.
  await pending.getByRole("listitem").nth(1).getByRole("radio", { name: "After" }).click();
  await page.getByRole("button", { name: "Remove notes.png" }).click();
  await expect(pending.getByRole("listitem")).toHaveCount(1);
  await page.getByTestId("trade-screenshots-input").setInputFiles({
    name: "result.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await pending.getByRole("listitem").nth(1).getByRole("radio", { name: "After" }).click();

  await page.getByRole("button", { name: /Log trade/ }).click();
  await expect(page).toHaveURL(/\/trades\/[^/]+$/);

  // Both arrived, served through the ownership-checked route, with their kinds.
  const shots = page.locator('img[src^="/api/attachments/"]');
  await expect(shots).toHaveCount(2);
  await expect(page.getByText("BEFORE", { exact: true })).toBeVisible();
  await expect(page.getByText("AFTER", { exact: true })).toBeVisible();
  expect(await shots.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  // The saved trade takes more.
  await page.locator('input[type="file"]').setInputFiles({ name: "later.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator('img[src^="/api/attachments/"]')).toHaveCount(3);
});
