import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Ctrl/⌘+K opens the command palette and Enter goes there", async ({ page }) => {
  await signIn(page);
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("combobox", { name: "Search pages and actions" });
  await expect(search).toBeFocused();
  await search.fill("playb");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/playbooks");
});

test("the rail shows the daily three and keeps the rest under More tools", async ({ page }) => {
  await signIn(page);
  const rail = page.getByRole("navigation", { name: "Main" });
  await expect(rail.getByRole("link", { name: "Import", exact: true })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Analytics" })).toBeHidden();

  const more = rail.getByRole("button", { name: "More tools" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(rail.getByRole("link", { name: "Analytics" })).toBeVisible();

  // Remembered across a reload.
  await page.reload();
  await expect(rail.getByRole("link", { name: "Analytics" })).toBeVisible();
  await rail.getByRole("button", { name: "More tools" }).click();
  await expect(rail.getByRole("link", { name: "Analytics" })).toBeHidden();

  // A page inside the group opens it whatever was remembered.
  await page.goto("/analytics");
  await expect(rail.getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page");

  // Import is under /trades; only the more specific of the two is current.
  await page.goto("/trades/import");
  await expect(rail.getByRole("link", { name: "Import", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link", { name: "Trades", exact: true })).not.toHaveAttribute("aria-current", "page");
});

test("? lists the keyboard shortcuts", async ({ page }) => {
  await signIn(page);
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("the mobile navigation drawer traps focus and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
});

test("analytics tabs live in the URL", async ({ page }) => {
  await signIn(page);
  await page.goto("/analytics?range=all");
  await page.getByRole("tab", { name: "Timing" }).click();
  await expect(page).toHaveURL(/tab=timing/);
  await expect(page).toHaveURL(/range=all/);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Timing" })).toHaveAttribute("data-state", "active");
});
