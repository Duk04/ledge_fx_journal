// Prisma CLI configuration.
//
// Deliberately minimal: schema location, and the seed command (which used to
// live in package.json#prisma, deprecated since Prisma 6).
//
// It does NOT register a driver adapter. Doing so made the CLI talk to Postgres
// through `@prisma/adapter-pg`, whose OID mapping is missing Postgres\'s own
// `name`/`char` catalog types — so `migrate deploy` died with "Column type
// \'name\' could not be deserialized from the database" while merely reading
// pg_catalog. The native schema engine has no such problem.
//
// If you are on a network that blocks binaries.prisma.sh (where the native
// engine is downloaded from), set PRISMA_JS_ENGINE=1 to fall back to the
// pure-JS engine driven over a `pg` connection. That path needs
// `engineType = "client"` on the generator block too — see docs/DATA-MODEL.md.
import { defineConfig } from "prisma/config";

// The Prisma CLI does not auto-load `.env` once a prisma.config.ts is present,
// so load it ourselves (Node built-in — no extra dependency).
try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. CI, where variables are injected directly).
}

const schema = "prisma/schema.prisma";
const migrations = { seed: "tsx prisma/seed.ts" };

// Two separate calls rather than one spread: `defineConfig`\'s parameter is a
// union (JS engine WITH an adapter, or no engine key at all), and a spread of
// optional keys does not narrow to either arm.
export default process.env.PRISMA_JS_ENGINE === "1"
  ? defineConfig({
      schema,
      migrations,
      experimental: { adapter: true },
      engine: "js",
      adapter: async () => {
        const { PrismaPg } = await import("@prisma/adapter-pg");
        return new PrismaPg({
          connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
        });
      },
    })
  : defineConfig({ schema, migrations });
