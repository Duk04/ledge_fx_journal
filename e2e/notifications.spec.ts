import { expect, test } from "@playwright/test";
import { register } from "./helpers";

// docs/NOTIFICATIONS.md — the in-app half, which needs no mail provider. The
// e2e server has no RESEND_API_KEY, so the email switches render disabled
// with the reason shown; that is asserted too.
test("a trade today raises the journal nudge, and Settings switches it off", async ({ page }) => {
  await register(page);

  await page.goto("/trades/new");
  await page.getByLabel("Symbol").click();
  await page.getByRole("option", { name: /^EURUSD/ }).click();
  await page.getByLabel("Volume (lots)").fill("1");
  await page.getByLabel("Entry price").fill("1.10000");
  await page.getByRole("button", { name: /Log trade/ }).click();
  await expect(page).toHaveURL(/\/trades\/[^/]+$/);

  await page.goto("/");
  const nudge = page.getByRole("status").filter({ hasText: "no journal entry yet" });
  await expect(nudge).toContainText("1 trade today");
  await expect(nudge.getByRole("link", { name: "Write today's journal" })).toHaveAttribute(
    "href",
    /^\/journal\/\d{4}-\d{2}-\d{2}$/,
  );

  await page.goto("/settings?tab=notifications");
  await expect(page.getByRole("switch", { name: "Journal reminder" })).toBeDisabled();
  await expect(page.getByText(/no mail provider configured/)).toBeVisible();
  await page.getByRole("switch", { name: "Journal nudge on the dashboard" }).click();
  await expect(page.getByText("Notification settings saved.")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("no journal entry yet")).toHaveCount(0);
});
