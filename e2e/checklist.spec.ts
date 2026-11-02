import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// docs/JOURNAL.md "Daily checklist": write your own list once, tick it per
// day; a removed item that was ticked stays on its day.
test("build a daily checklist, tick it, and see it on the calendar", async ({ page }) => {
  await register(page);
  await page.goto("/journal/2026-10-17");

  const add = page.getByRole("textbox", { name: /Add something to check/ });
  await add.fill("Check the 1H trend");
  // Exact: the day page also has the screenshots' "Add link instead".
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Rename Check the 1H trend" })).toBeVisible();
  // Clicking Add blurs the field first; that must still add it once.
  await expect(page.getByRole("textbox", { name: "Rename Check the 1H trend" })).toHaveCount(1);
  // Leaving the field saves what was typed, with no button at all.
  await add.fill("Wait for a 1m FVG");
  await add.blur();
  await expect(page.getByRole("textbox", { name: "Rename Wait for a 1m FVG" })).toBeVisible();
  await expect(add).toHaveValue("");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("checkbox", { name: "Check the 1H trend" }).click();
  await expect(page.getByText("1 of 2 done")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Check the 1H trend" })).toBeChecked();

  // The calendar marks the day.
  await page.goto("/journal?month=2026-10");
  await expect(page.getByLabel("1 checklist item ticked")).toBeVisible();

  // Removing a ticked item keeps it on its day, read-only.
  await page.goto("/journal/2026-10-17");
  await page.getByRole("button", { name: "Edit list" }).click();
  await page.getByRole("button", { name: "Remove Check the 1H trend" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("checkbox", { name: /Check the 1H trend/ })).toBeDisabled();
  await page.goto("/journal/2026-10-18");
  await expect(page.getByRole("checkbox", { name: /Check the 1H trend/ })).toHaveCount(0);
});
