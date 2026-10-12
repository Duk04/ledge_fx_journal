/**
 * End-to-end tests: the four flows docs/TESTING.md names, against a real
 * production build (`next build && next start`) and a real Postgres.
 *
 *   npm run test:e2e        # E2E_DATABASE_URL optional, defaults to DATABASE_URL
 *
 * Every run migrates and seeds a fresh scratch schema and drops it at the end
 * (e2e/db-url.ts explains why that, and not a database reset). Port 3100
 * rather than 3000 so a running dev server is left alone — and never reused,
 * since it points at a different schema.
 */
import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/db-url";

try {
  process.loadEnvFile();
} catch {
  // No .env (CI): the job provides the variables.
}

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const databaseUrl = e2eDatabaseUrl();

export default defineConfig({
  testDir: "e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  // One worker: the specs share one seeded database, and some of them write.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    // Pinned so wall-clock assertions (the trade form's datetime-local
    // inputs, the session a trade lands in) do not depend on the machine
    // running the suite. Matches the default User.timezone.
    timezoneId: "Asia/Ulaanbaatar",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx tsx e2e/prepare-db.ts && npx next build && npx next start -p " + PORT,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      AUTH_SECRET: "e2e-only-signing-secret-not-for-production-0123",
      AUTH_URL: baseURL,
      AUTH_TRUST_HOST: "true",
      ALLOW_PASSWORD_LOGIN: "true",
      ALLOW_REGISTRATION: "true",
      REQUIRE_EMAIL_VERIFICATION: "false",
      // No mail provider, whatever a developer's .env says: the specs assert
      // the "email unavailable" state and must never send real mail.
      RESEND_API_KEY: "",
      AUTH_RESEND_KEY: "",
    },
  },
});
