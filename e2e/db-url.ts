/**
 * The e2e run's database location, shared by playwright.config.ts (which
 * hands it to the server) and the teardown (which drops it).
 *
 * Each run gets its own SCRATCH SCHEMA inside the target database, created by
 * e2e/prepare-db.ts and dropped by e2e/global-teardown.ts — the same approach
 * as `npm run test:db`. Nothing outside that schema is read or written, so
 * pointing the suite at a database with real data in it does not touch that
 * data. (An earlier draft reset the whole database with
 * `prisma migrate reset`; Prisma refuses to run that from an AI agent
 * without a human's explicit consent, and a design that never needs a
 * destructive reset is the better answer anyway.)
 */
export function e2eBaseUrl(): string {
  const base = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error("Set E2E_DATABASE_URL (or DATABASE_URL) to a Postgres the e2e run can create a schema in.");
  }
  const url = new URL(base);
  url.searchParams.delete("schema");
  return url.toString();
}

/** Stable for the whole run: computed once in the Playwright main process
 * and inherited, via the environment, by the teardown. */
export function e2eSchema(): string {
  process.env.E2E_SCHEMA ??= `e2e_${Date.now().toString(36)}`;
  return process.env.E2E_SCHEMA;
}

export function e2eDatabaseUrl(): string {
  const url = new URL(e2eBaseUrl());
  url.searchParams.set("schema", e2eSchema());
  return url.toString();
}
