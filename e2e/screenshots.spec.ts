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
  await page.getByLabel("Risk amount").fill("100");

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

  // And a note, written right there: it saves when the field is left.
  const note = page.getByLabel("Note", { exact: true });
  await note.fill("Entered on the retest.");
  await note.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue("Entered on the retest.");
});

// docs/JOURNAL.md "Screenshots on a journal day": a chart pasted while the plan
// is being written is filed as pre-market, saved at once, and still there on
// the next visit.
test("a chart pasted into the day's plan is saved on the day as pre-market", async ({ page }) => {
  await register(page);
  await page.goto("/journal/2026-03-04");

  await page.getByPlaceholder(/What's the plan today/).click();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "chart.png", { type: "image/png" }));
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, PNG.toString("base64"));

  const shots = page.locator('img[src^="/api/attachments/"]');
  await expect(shots).toHaveCount(1);
  await expect(page.getByText("PRE-MARKET", { exact: true })).toBeVisible();
  // The textarea took no text from the paste: only the image was intercepted.
  await expect(page.getByPlaceholder(/What's the plan today/)).toHaveValue("");

  await page.reload();
  await expect(page.locator('img[src^="/api/attachments/"]')).toHaveCount(1);
  expect(await shots.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
});
