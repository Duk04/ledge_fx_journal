import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// docs/JOURNAL.md "Stats": the range drives the cards and the balance chart;
// the calendar tints days and totals each week. The seed's trades end on
// 2026-08-24, so a fixed range keeps this independent of today's date.
test("journal shows range stats, a balance chart and a calendar with weekly totals", async ({ page }) => {
  await signIn(page);
  await page.goto("/journal?from=2026-07-24&to=2026-08-24");

  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-07-24");
  await expect(page.getByText("Total P&L", { exact: true })).toBeVisible();
  await expect(page.getByText("Trade win %", { exact: true })).toBeVisible();
  await expect(page.getByText("Best trade", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Balance from / })).toBeVisible();
  // August 2026 — the month the range ends in — with a total per week row.
  await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
  await expect(page.getByText("Week 1", { exact: true })).toBeVisible();

  // A preset rewrites the range in the URL and keeps the calendar's month.
  await page.goto("/journal?from=2026-07-24&to=2026-08-24&month=2026-07");
  await page.getByRole("radio", { name: "Today" }).click();
  await expect(page).toHaveURL(/month=2026-07/);
  await expect(page.getByRole("radio", { name: "Today" })).toHaveAttribute("data-state", "on");
});
