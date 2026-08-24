import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma Client singleton for Next.js dev hot-reload.
//
// This project's `prisma/schema.prisma` generator uses `engineType = "client"`
// (the pure-JS/Wasm query engine) instead of the native Rust query engine
// binary, because this sandbox's network policy blocks the CDN
// (binaries.prisma.sh) that the classic engine downloads from. That engine
// type has no binary to load at all, but it always talks to the database
// through an explicit driver adapter rather than a bare connection string
// — hence constructing `@prisma/adapter-pg` here instead of only passing a
// `datasourceUrl`. Everything else about this singleton (the globalThis
// cache to survive Next.js dev hot-reload, log configuration) is the
// standard Prisma-for-Next.js pattern and would look the same with the
// classic engine.
//
// See docs/DATA-MODEL.md for more on this decision.

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log:
      process.env.PRISMA_LOG === "1"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

/**
 * `db` is the name the rest of the app imports. Both names point at the same
 * singleton — `prisma` is kept because the Prisma docs use it, `db` because
 * every query site reads better as `db.trade.findMany`.
 */
export const db = prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
