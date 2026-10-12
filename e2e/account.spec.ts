import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// docs/AUTH.md — account lifecycle. The e2e server has no mail provider, so
// the reset flow can only show that it says so; the token mechanics are
// covered against Postgres in account-lifecycle.db.test.ts.

test("forgot-password is reachable from sign-in and says when email is unavailable", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL("/forgot-password");
  await expect(page.getByText("isn't available on this instance")).toBeVisible();
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL("/login");
});

test("an expired or made-up reset link says so before asking for a password", async ({ page }) => {
  await page.goto("/reset-password?token=not-a-real-token");
  await expect(page.getByText("This reset link has expired or was already used.")).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);
});

test("deleting the account removes it and signs out", async ({ page }) => {
  const { email, password } = await register(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });

  await dialog.getByLabel("Your email").fill(email);
  await dialog.getByLabel("Password").fill("not-my-password");
  await dialog.getByRole("button", { name: "Delete everything" }).click();
  await expect(dialog.getByText("That password isn't right.")).toBeVisible();

  await dialog.getByLabel("Password").fill(password);
  await dialog.getByRole("button", { name: "Delete everything" }).click();
  await expect(page).toHaveURL("/login?deleted=1");
  await expect(page.getByText("Your account and all of its data have been deleted.")).toBeVisible();

  // The account is gone, not just signed out.
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});
