import { expect, test } from "@playwright/test";
import { register, signIn } from "./helpers";

// Flow 1 of docs/TESTING.md: register -> dashboard -> sign out -> sign in.
test("register, reach the dashboard, sign out and back in", async ({ page }) => {
  const { email, password } = await register(page);

  // Registration signs the new user straight in. A new user gets a trading account at registration, so the dashboard
  // renders rather than bouncing to /accounts.
  await expect(page.getByText("Net P&L").first()).toBeVisible();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  // Signed out means signed out: the dashboard bounces back to /login.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, email, password);
});

test("a wrong password is refused with a message, not a crash", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("duk@example.com");
  await page.locator("#password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

// Regression: sign-out used to be a <form> inside the Radix menu item. The
// menu closing unmounted it and the browser cancelled the submit, so nobody
// could sign out at all — by mouse or keyboard.
test("sign out works from the keyboard", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Account menu" }).press("Enter");
  await page.getByRole("menuitem", { name: "Sign out" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
