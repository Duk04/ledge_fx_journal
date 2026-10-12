/**
 * Builds the e2e run's database: migrates its scratch schema (see
 * e2e/db-url.ts) from the committed migrations, seeds the demo data, and
 * computes the derived analytics columns. Run by playwright.config.ts's
 * webServer command before the server starts; not meant to be run by hand.
 *
 * `migrate deploy` into an empty schema — never `migrate reset` — so this
 * script has no way to destroy anything that existed before it ran.
 */
import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).searchParams.get("schema")?.startsWith("e2e_")) {
  throw new Error("prepare-db expects DATABASE_URL to point at an e2e_ scratch schema (set by playwright.config.ts).");
}

const env = { ...process.env, DIRECT_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { env, stdio: "inherit" });

run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["tsx", "prisma/seed.ts"]);
run("npx", ["tsx", "scripts/backfill-metrics.ts"]);
