import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma Client singleton, cached on globalThis so Next.js dev hot-reload does
 * not open a new connection pool on every edit.
 *
 * By default this is the plain, boring construction: the native query engine
 * reads the connection string from the datasource block in schema.prisma.
 *
 * `PRISMA_JS_ENGINE=1` switches to the pure-JS engine driven over a `pg`
 * connection instead. That exists for networks that cannot reach
 * binaries.prisma.sh (where the native engine is downloaded from) and it is
 * NOT the happy path: it also requires `engineType = "client"` on the
 * generator block, and the `@prisma/adapter-pg` it depends on has an OID
 * mapping gap that breaks `prisma migrate` on some Postgres servers. Use it
 * only when the default genuinely cannot work. docs/DATA-MODEL.md has the
 * details.
 */

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const log: ("query" | "warn" | "error")[] =
  process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"];

function createPrismaClient() {
  if (process.env.PRISMA_JS_ENGINE === "1") {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    return new PrismaClient({ adapter, log });
  }
  return new PrismaClient({ log });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * ONE exported name: `prisma`.
 *
 * This module used to export the same singleton three times — as `prisma`,
 * as `db`, and as a default — with a comment claiming "`db` is the name the
 * rest of the app imports". That was not true: `prisma` was imported in 26
 * files, `db` in 4, and the default in none. All an alias bought was a coin
 * flip for every new file, and a comment that told a new reader the wrong
 * answer.
 */
