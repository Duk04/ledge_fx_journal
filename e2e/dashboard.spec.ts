import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Flow 3 of docs/TESTING.md: the dashboard and analytics with a range change.
// The seeded trades are in mid-2026, so "All" is what puts data on screen.
test("changing the dashboard range is reflected in the URL and the data", async ({ page }) => {
  await signIn(page);

  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "All" }).click();
  await expect(page).toHaveURL(/range=all/);
  await expect(page.getByText("No activity in this range")).toBeHidden();
  await expect(page.getByText("Recent trades")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("radio", { name: "All" })).toHaveAttribute("data-state", "on");
});

// The Overview is the whole picture on one page: the figure cards, the daily
// balance, the holding-time bars and the month calendar.
test("the overview shows the cards, the charts and a calendar that pages without losing the range", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/?range=all&month=2026-08");

  await expect(page.getByText("Total P&L", { exact: true })).toBeVisible();
  await expect(page.getByText("Trade win %")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Balance from/ })).toBeVisible();
  await expect(page.getByText("Trades by duration")).toBeVisible();
  await expect(page.getByText("Win rate by duration")).toBeVisible();
  await expect(page.getByText("August 2026")).toBeVisible();
  await expect(page.getByText("Week 1")).toBeVisible();

  // A day with trades leads to exactly those trades: the list counts a day
  // the way the calendar cell does (by close date), so the two numbers match.
  const dayCell = page.locator('a[href^="/trades?view=days&day=2026-08-"]').first();
  const inCell = Number(/(\d+) trades?/.exec(await dayCell.innerText())![1]);
  await dayCell.click();
  await expect(page).toHaveURL(/\/trades\?view=days&day=2026-08-\d\d$/);
  await expect(page.getByText(new RegExp(`^${inCell} trades? in view`))).toBeVisible();
  // One day, as a panel of its own, saying the same count again.
  await expect(page.getByRole("heading", { name: /August \d+, 2026/ })).toHaveCount(1);
  await expect(page.getByText(new RegExp(`^${inCell} trades? ·`))).toBeVisible();
  await page.goto("/?range=all&month=2026-08");

  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page).toHaveURL(/month=2026-07/);
  await expect(page).toHaveURL(/range=all/);
  await expect(page.getByText("July 2026")).toBeVisible();

  // And the other way: a range change keeps the month the calendar is on.
  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "90D" }).click();
  await expect(page).toHaveURL(/range=90d/);
  await expect(page).toHaveURL(/month=2026-07/);
});

test("analytics renders every tab for the full range", async ({ page }) => {
  await signIn(page);
  await page.goto("/analytics?range=all");

  await expect(page.getByText("Symbol").first()).toBeVisible();
  await page.getByRole("tab", { name: "Timing" }).click();
  await expect(page.getByText("Session heatmap")).toBeVisible();
  await page.getByRole("tab", { name: "Distribution" }).click();
  await expect(page.getByRole("tabpanel")).toBeVisible();

  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "7D" }).click();
  await expect(page).toHaveURL(/range=7d/);
});
