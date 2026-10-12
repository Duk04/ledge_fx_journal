import { expect, test } from "@playwright/test";
import { duplicateSeededTrades, signIn } from "./helpers";

// Flow 4 of docs/TESTING.md: the trades filter and pagination round-trip
// through the URL. This is the test that would have caught the debounce bug
// fixed in filter-bar.tsx.
test("search survives a reload and pagination keeps it", async ({ page }) => {
  // The demo user's active account (the seed's first) — doubled so that 25
  // rows per page leaves a second page to move to.
  await duplicateSeededTrades("FTMO 50k Challenge");
  await signIn(page);
  await page.goto("/trades?pageSize=25");

  const search = page.getByRole("textbox", { name: "Search trades" });
  await search.fill("EUR");
  await expect(page).toHaveURL(/q=EUR/);

  const symbols = page.locator("tbody tr td:nth-child(2) span.font-medium");
  await expect(symbols.first()).toBeVisible();
  for (const text of await symbols.allInnerTexts()) expect(text).toContain("EUR");

  await page.reload();
  await expect(search).toHaveValue("EUR");

  // Clearing the search restores the full list, and paging writes ?page=2
  // without dropping the page size.
  await search.fill("");
  await expect(page).not.toHaveURL(/q=/);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/pageSize=25/);
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();

  // A filter change starts back at page 1.
  await search.fill("USD");
  await expect(page).toHaveURL(/q=USD/);
  await expect(page).not.toHaveURL(/page=2/);
});
