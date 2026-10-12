/**
 * globalSetup for the `db` vitest project (`npm run test:db`).
 *
 * Migrates a SCRATCH SCHEMA — `test_<pid>_<time>` — inside an existing local
 * Postgres, hands its URL to the test workers, and drops it afterwards. That
 * is the shape docs/TESTING.md chose over testcontainers: no Docker
 * requirement, and every run exercises the real migration files from an
 * empty schema, so a migration that only works on top of a dev database's
 * accumulated state fails here first.
 *
 * Point it at a database with TEST_DATABASE_URL. It falls back to
 * DATABASE_URL, which is safe because nothing outside the scratch schema is
 * read or written — but the fallback is a convenience, not a recommendation.
 */
import { execFileSync } from "node:child_process";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

function withSchema(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  return url.toString();
}

/** `pg` does not understand Prisma's `?schema=` parameter; strip it. */
function withoutSchema(base: string): string {
  const url = new URL(base);
  url.searchParams.delete("schema");
  return url.toString();
}

export default async function setup(project: TestProject) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env (CI): the variables are injected by the job instead.
  }
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "npm run test:db needs a Postgres to create a scratch schema in. Set TEST_DATABASE_URL " +
        "(or DATABASE_URL), e.g. postgresql://postgres:postgres@127.0.0.1:5432/fxjournal.",
    );
  }

  const schema = `test_${process.pid}_${Date.now().toString(36)}`;
  const url = withSchema(base, schema);

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });

  project.provide("databaseUrl", url);

  return async () => {
    const client = new pg.Client({ connectionString: withoutSchema(base) });
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  };
}
