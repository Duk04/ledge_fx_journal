import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { e2eBaseUrl, e2eSchema } from "./db-url";

/** The seeded demo user (prisma/seed.ts). */
export const DEMO = { email: "duk@example.com", password: "password" };

export async function signIn(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto("/login");
  // By id rather than label: ids do not change with the UI language.
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

/** Registers a fresh user — which also signs them in and lands on the
 * dashboard — and returns their credentials. Registration is rate-limited per
 * IP (5/hour); each run starts from a fresh schema, so that budget resets,
 * but specs should still call this sparingly. */
export async function register(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = "correct-horse-battery";
  await page.goto("/register");
  await page.locator("#reg-name").fill("E2E Trader");
  await page.locator("#reg-email").fill(email);
  await page.locator("#reg-password").fill(password);
  await page.locator("#reg-confirm").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  // Registration ends in a Server Action redirect; let that navigation and
  // the dashboard's streamed panels settle before the spec acts, or a click
  // can land while the router is still mid-transition and be dropped.
  await page.waitForLoadState("networkidle");
  return { email, password };
}

/** The value cell of a "label  value" row on the trade detail page. */
export function fact(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=following-sibling::span[1]");
}

/**
 * Doubles the trades of the seeded account whose label is given, directly in
 * this run's scratch schema. The seed has ~23 trades per account and the
 * smallest page size is 25, so pagination has nothing to page without this.
 * Copies get fresh ids and no broker ticket (which is unique per account).
 */
export async function duplicateSeededTrades(accountLabel: string) {
  const client = new pg.Client({ connectionString: e2eBaseUrl() });
  await client.connect();
  try {
    await client.query(`SET search_path TO "${e2eSchema()}"`);
    await client.query("BEGIN");
    await client.query(
      `CREATE TEMP TABLE copies ON COMMIT DROP AS
         SELECT t.* FROM trades t JOIN accounts a ON a.id = t.account_id WHERE a.label = $1`,
      [accountLabel],
    );
    await client.query("UPDATE copies SET id = gen_random_uuid(), external_ticket = NULL");
    await client.query("INSERT INTO trades SELECT * FROM copies");
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

/** Writes `count` synthetic bars into this run's scratch schema — enough for
 * a trade's chart to render. Shared candle data, so no user is involved. */
export async function insertCandles(
  symbol: string,
  timeframe: string,
  fromIso: string,
  count: number,
  stepMinutes: number,
) {
  const client = new pg.Client({ connectionString: e2eBaseUrl() });
  await client.connect();
  try {
    await client.query(`SET search_path TO "${e2eSchema()}"`);
    const start = new Date(fromIso).getTime();
    for (let i = 0; i < count; i++) {
      const p = 1.1 + Math.sin(i / 6) * 0.002;
      await client.query(
        `INSERT INTO candles (symbol, timeframe, ts, open, high, low, close, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'GENERIC_CSV') ON CONFLICT DO NOTHING`,
        [symbol, timeframe, new Date(start + i * stepMinutes * 60_000), p, p + 0.0006, p - 0.0006, p + 0.0002],
      );
    }
  } finally {
    await client.end();
  }
}
