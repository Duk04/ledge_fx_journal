import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// docs/I18N.md. Every other spec runs in English (playwright.config.ts pins
// locale en-US); this one proves the other language end to end, on a user of
// its own so the demo user's language never changes under another spec.

test.describe("a first visit follows the browser's language", () => {
  test.use({ locale: "mn-MN" });

  test("the login page renders in Mongolian", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Нэвтрэх", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "mn");
  });
});

test("choosing Mongolian applies at once, survives sign-in, and reaches validation", async ({ page, browser }) => {
  const { email, password } = await register(page);

  await page.goto("/settings");
  await page.getByRole("radio", { name: "Монгол" }).click();
  await expect(page.getByRole("heading", { name: "Тохиргоо" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "mn");

  // A fresh browser that asks for English still gets Mongolian once this
  // user signs in: the choice lives on the user, not in one browser's cookie.
  const other = await browser.newContext({ locale: "en-US" });
  const fresh = await other.newPage();
  await fresh.goto("/login");
  await fresh.locator("#email").fill(email);
  await fresh.locator("#password").fill(password);
  await fresh.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(fresh).toHaveURL("/");
  await expect(fresh.getByRole("heading", { name: "Тойм" })).toBeVisible();

  // Schema messages travel as keys and are rendered in the reader's language.
  await fresh.goto("/trades/new");
  await fresh.getByRole("button", { name: /Арилжаа бүртгэх/ }).click();
  await expect(fresh.getByText("Эрсдэлийн дүн заавал")).toBeVisible();
  await other.close();
});
