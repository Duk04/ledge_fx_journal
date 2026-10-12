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
