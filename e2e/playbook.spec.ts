import { expect, test } from "@playwright/test";
import { insertCandles, register } from "./helpers";

test("write a playbook, take a trade as it, check its rules, see it on a chart", async ({ page }) => {
  await register(page);

  await page.goto("/playbooks");
  await page.getByRole("button", { name: "New playbook" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("London breakout");
  await dialog.getByLabel("Rules").fill("H4 trend agrees\nRetest of Asian high");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "London breakout" })).toBeVisible();

  await page.goto("/trades/new");
  await page.getByLabel("Symbol").click();
  await page.getByRole("option", { name: /^EURUSD/ }).click();
  await page.getByLabel("Playbook").click();
  await page.getByRole("option", { name: "London breakout" }).click();
  await page.getByLabel("Risk amount").fill("100");
  await page.getByLabel("Planned R:R").fill("2");
  await page.getByRole("radio", { name: "Closed" }).click();
  await page.getByRole("radio", { name: "Win" }).click();
  await page.getByLabel("Opened at").fill("2026-03-04T17:00");
  await page.getByLabel("Closed at").fill("2026-03-04T19:00");
  await page.getByRole("button", { name: /Log trade/ }).click();
  await expect(page).toHaveURL(/\/trades\/(?!new$)[^/]+$/);

  for (const rule of ["H4 trend agrees", "Retest of Asian high"]) {
    await page.getByRole("radiogroup", { name: rule }).getByRole("radio", { name: "Followed" }).click();
    await expect(page.getByRole("radiogroup", { name: rule }).getByRole("radio", { name: "Followed" })).toHaveAttribute(
      "data-state",
      "on",
    );
  }
  await expect(page.getByText("by the book")).toBeVisible();

  await page.goto("/playbooks");
  await expect(page.getByText("100.0% of rules followed")).toBeVisible();

  // Candles around the trade (opened 09:00Z, closed 11:00Z) -> a chart appears.
  await insertCandles("EURUSD", "M5", "2026-03-04T06:00:00Z", 100, 5);
  await page.goBack();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Chart" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Price chart around the trade/ })).toBeVisible();
});
