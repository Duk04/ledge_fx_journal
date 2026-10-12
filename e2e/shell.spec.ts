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
