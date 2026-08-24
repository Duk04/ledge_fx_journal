// Prisma CLI configuration.
//
// This project's sandboxed dev environment cannot reach binaries.prisma.sh
// (the CDN Prisma's CLI normally downloads its native schema-engine /
// query-engine binaries from), so the CLI is pointed at the JS/Wasm schema
// engine instead, driven over a real `pg` connection via the official
// `@prisma/adapter-pg` driver adapter. This requires no native binary
// download at all. See docs/DATA-MODEL.md for more context.
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

// The Prisma CLI does not auto-load `.env` once a prisma.config.ts is
// present, so load it ourselves (Node's built-in loader — no extra
// dependency needed).
try {
  process.loadEnvFile();
} catch {
  // no .env file present (e.g. in CI where vars are injected directly)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: {
    adapter: true,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  engine: "js",
  adapter: async () => new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
